import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SandboxRef, SandboxState } from "./backend.js";
import type { JobStatus } from "./jobs.js";
import type { SourceSnapshot } from "./source.js";

/**
 * Local, non-secret bookkeeping shared by the CLI and the OpenCode plugin. It never
 * holds credentials, preview access headers, file contents, or command output.
 */

export type JobRecord = {
  id: string;
  command: string;
  cwd: string;
  snapshotId: string | null;
  snapshotDigest: string | null;
  /** Checkout the snapshot was captured from; together with `snapshotId` it names the manifest. */
  snapshotRoot?: string | null;
  status: JobStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  timeoutMs: number;
  /** Names (never values) of variables passed to the job. */
  secretNames: string[];
};

/** A downloaded file and the job (and therefore snapshot) that produced it. */
export type ArtifactRecord = {
  localPath: string;
  remotePath: string;
  sha256: string;
  bytes: number;
  jobId: string;
  fetchedAt: string;
};

export type SandboxRecord = SandboxRef & {
  name: string;
  purpose: string;
  /** Local checkout the sandbox serves, when known. */
  project: string | null;
  sessionId: string | null;
  state: SandboxState;
  publicPreviews: boolean;
  createdAt: string;
  expiresAt: string | null;
  snapshot: { id: string; digest: string; root?: string; syncedAt: string } | null;
  jobs: Record<string, JobRecord>;
  artifacts?: Record<string, ArtifactRecord>;
  previews: Record<string, { port: number; jobId: string | null; url: string; public: boolean }>;
  updatedAt: string;
};

export interface SandboxStore {
  list(): Promise<SandboxRecord[]>;
  get(ref: SandboxRef): Promise<SandboxRecord | null>;
  put(record: SandboxRecord): Promise<void>;
  /**
   * Read-modify-write under a lock shared by every process using this directory, so the
   * CLI and the plugin never drop each other's jobs. `create` supplies a record when none
   * is stored; without one, nothing is written and null is returned.
   */
  update(
    ref: SandboxRef,
    mutate: (record: SandboxRecord) => void,
    create?: () => SandboxRecord | null,
  ): Promise<SandboxRecord | null>;
  remove(ref: SandboxRef): Promise<void>;
  /** Manifests (paths and hashes, no contents) for stale checks when applying artifacts. */
  putSnapshot(snapshot: SourceSnapshot): Promise<void>;
  /** Snapshot ids describe content only; the checkout root selects the right manifest. */
  getSnapshot(id: string, root: string): Promise<SourceSnapshot | null>;
}

export function defaultStoreDirectory(): string {
  const base = process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state");
  return path.join(base, "gitterm", "sandboxes");
}

const fileName = (ref: SandboxRef) =>
  `${ref.mode}-${ref.provider}-${ref.account}-${ref.id}`.replace(/[^A-Za-z0-9_.-]/g, "_") + ".json";

const snapshotFile = (id: string, root: string) =>
  `${id.replace(/[^A-Za-z0-9_]/g, "")}-${createHash("sha256").update(root).digest("hex").slice(0, 16)}.json`;

const LOCK_STALE_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An exclusive lock file; a holder that died releases it once it is stale. */
async function withFileLock<T>(target: string, action: () => Promise<T>): Promise<T> {
  const lock = `${target}.lock`;
  const deadline = Date.now() + 2 * LOCK_STALE_MS;
  while (true) {
    try {
      await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = await stat(lock).then(
        (info) => Date.now() - info.mtimeMs,
        () => 0,
      );
      if (age > LOCK_STALE_MS) await rm(lock, { force: true });
      else if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
      else await sleep(5 + Math.random() * 20);
    }
  }
  try {
    return await action();
  } finally {
    await rm(lock, { force: true });
  }
}

export function createFileSandboxStore(directory = defaultStoreDirectory()): SandboxStore {
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(directory, file), "utf8")) as SandboxRecord;
  const write = async (target: string, record: SandboxRecord) => {
    // A unique name per write: concurrent writers never rename each other's file.
    const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  };
  // An in-process queue per record in front of the cross-process file lock.
  const queues = new Map<string, Promise<unknown>>();
  const serialized = <T>(target: string, action: () => Promise<T>): Promise<T> => {
    const next = (queues.get(target) ?? Promise.resolve())
      .catch(() => {})
      .then(() => withFileLock(target, action));
    queues.set(target, next);
    void next.then(
      () => queues.get(target) === next && queues.delete(target),
      () => queues.get(target) === next && queues.delete(target),
    );
    return next;
  };

  return {
    async list() {
      const files = await readdir(directory).catch(() => [] as string[]);
      const records = await Promise.all(
        files.filter((file) => file.endsWith(".json")).map((file) => read(file).catch(() => null)),
      );
      return records.filter((record): record is SandboxRecord => record !== null);
    },
    async get(ref) {
      return read(fileName(ref)).catch(() => null);
    },
    async put(record) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = path.join(directory, fileName(record));
      await serialized(target, () => write(target, record));
    },
    async update(ref, mutate, create) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = path.join(directory, fileName(ref));
      return serialized(target, async () => {
        const current = (await read(fileName(ref)).catch(() => null)) ?? create?.() ?? null;
        if (!current) return null;
        mutate(current);
        current.updatedAt = new Date().toISOString();
        await write(target, current);
        return current;
      });
    },
    async remove(ref) {
      await rm(path.join(directory, fileName(ref)), { force: true });
    },
    async putSnapshot(snapshot) {
      const target = path.join(directory, "snapshots", snapshotFile(snapshot.id, snapshot.root));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, JSON.stringify(snapshot), { mode: 0o600 });
    },
    async getSnapshot(id, root) {
      return readFile(path.join(directory, "snapshots", snapshotFile(id, root)), "utf8")
        .then((text) => JSON.parse(text) as SourceSnapshot)
        .catch(() => null);
    },
  };
}

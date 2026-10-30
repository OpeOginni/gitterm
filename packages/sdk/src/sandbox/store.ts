import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  status: JobStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  timeoutMs: number;
  /** Names (never values) of variables passed to the job. */
  secretNames: string[];
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
  snapshot: { id: string; digest: string; syncedAt: string } | null;
  jobs: Record<string, JobRecord>;
  previews: Record<string, { port: number; jobId: string | null; url: string; public: boolean }>;
  updatedAt: string;
};

export interface SandboxStore {
  list(): Promise<SandboxRecord[]>;
  get(ref: SandboxRef): Promise<SandboxRecord | null>;
  put(record: SandboxRecord): Promise<void>;
  remove(ref: SandboxRef): Promise<void>;
  /** Manifests (paths and hashes, no contents) for stale checks when applying artifacts. */
  putSnapshot(snapshot: SourceSnapshot): Promise<void>;
  getSnapshot(id: string): Promise<SourceSnapshot | null>;
}

export function defaultStoreDirectory(): string {
  const base = process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state");
  return path.join(base, "gitterm", "sandboxes");
}

const fileName = (ref: SandboxRef) =>
  `${ref.mode}-${ref.provider}-${ref.account}-${ref.id}`.replace(/[^A-Za-z0-9_.-]/g, "_") + ".json";

export function createFileSandboxStore(directory = defaultStoreDirectory()): SandboxStore {
  const read = async (file: string) =>
    JSON.parse(await readFile(path.join(directory, file), "utf8")) as SandboxRecord;
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
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
      await rename(temporary, target);
    },
    async remove(ref) {
      await rm(path.join(directory, fileName(ref)), { force: true });
    },
    async putSnapshot(snapshot) {
      const target = path.join(
        directory,
        "snapshots",
        `${snapshot.id.replace(/[^A-Za-z0-9_]/g, "")}.json`,
      );
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, JSON.stringify(snapshot), { mode: 0o600 });
    },
    async getSnapshot(id) {
      const file = path.join(directory, "snapshots", `${id.replace(/[^A-Za-z0-9_]/g, "")}.json`);
      return readFile(file, "utf8")
        .then((text) => JSON.parse(text) as SourceSnapshot)
        .catch(() => null);
    },
  };
}

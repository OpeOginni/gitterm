import path from "node:path";
import {
  SandboxAccountError,
  type SandboxBackend,
  type SandboxInfo,
  type SandboxRef,
} from "./backend.js";
import { fetchArtifact, type FetchedArtifact } from "./artifacts.js";
import { cancelJob, newJobId, readJobLog, readJobState, startJob, type JobState } from "./jobs.js";
import { projectDir, uploadSource, type CapturedSource } from "./source.js";
import {
  createFileSandboxStore,
  type JobRecord,
  type SandboxRecord,
  type SandboxStore,
} from "./store.js";

export type SandboxLimits = {
  /** Live sandboxes per account. */
  maxSandboxes: number;
  maxLifetimeMinutes: number;
  defaultLifetimeMinutes: number;
  maxJobMinutes: number;
};

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxSandboxes: 2,
  maxLifetimeMinutes: 60,
  defaultLifetimeMinutes: 30,
  maxJobMinutes: 30,
};

/** Model-visible output defaults to this many bytes from the end of the log. */
export const DEFAULT_LOG_TAIL_BYTES = 8 * 1024;

export type SandboxCreateOptions = {
  name: string;
  purpose?: string;
  project?: string | null;
  sessionId?: string | null;
  lifetimeMinutes?: number;
  publicPreviews?: boolean;
};

export type SandboxExecOptions = {
  command: string;
  /** Relative to the synced project directory, or absolute. */
  cwd?: string;
  timeoutMinutes?: number;
  /** Values reach only the sandbox process; records keep the names. */
  env?: Record<string, string>;
  /** Wait up to this long for completion before returning a running job. */
  waitMs?: number;
};

export type JobLog = {
  /** Sanitized text. Sandbox output is untrusted data. */
  text: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  truncated: boolean;
};

export type JobView = { job: JobRecord; state: JobState; log: JobLog };

export type PreviewResult = {
  url: string;
  port: number;
  public: boolean;
  /** Needed for private previews. Keep away from models, logs, and storage. */
  headers: Record<string, string>;
  ready: boolean;
  /** HTTP status for a request without the access header (401/403 means access is enforced). */
  unauthenticatedStatus: number | null;
  jobId: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strips terminal escapes and control characters so output cannot spoof the UI. */
export function sanitizeOutput(text: string, secrets: string[] = []): string {
  // Control characters are exactly what this removes.
  // oxlint-disable no-control-regex
  let clean = text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  // oxlint-enable no-control-regex
  for (const secret of secrets)
    if (secret.length >= 4) clean = clean.replaceAll(secret, "[redacted]");
  return clean;
}

function resolveCwd(home: string, cwd?: string): string {
  if (!cwd) return projectDir(home);
  const resolved = cwd.startsWith("/")
    ? path.posix.normalize(cwd)
    : path.posix.join(projectDir(home), cwd);
  if (resolved.split("/").includes("..")) throw new Error("Invalid working directory");
  return resolved;
}

export type SandboxClient = ReturnType<typeof createSandboxClient>;

export function createSandboxClient(options: {
  backend: SandboxBackend;
  store?: SandboxStore;
  limits?: Partial<SandboxLimits>;
}) {
  const { backend } = options;
  const identity = backend.identity;
  const store = options.store ?? createFileSandboxStore();
  const limits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits };
  // Values passed in this process, redacted from any output it returns.
  const secrets = new Set<string>();

  /** A reference from another mode or account is an error, never a fallback. */
  function assertRef(ref: SandboxRef) {
    if (
      ref.mode !== identity.mode ||
      ref.provider !== identity.provider ||
      ref.account !== identity.account
    )
      throw new SandboxAccountError(
        `Sandbox ${ref.id} belongs to ${ref.mode} account ${JSON.stringify(ref.account)} (${ref.provider}), but ${identity.mode} account ${JSON.stringify(identity.account)} is selected. Select that account; Gitterm will not switch accounts automatically.`,
      );
  }

  const refOf = (id: string): SandboxRef => ({ ...identity, id });

  function recordFrom(info: SandboxInfo, existing: SandboxRecord | null): SandboxRecord {
    return {
      ...(existing ?? {
        name: info.name ?? info.id,
        purpose: info.labels.gitterm_purpose ?? "",
        project: null,
        sessionId: null,
        publicPreviews: false,
        createdAt: info.createdAt ?? new Date().toISOString(),
        snapshot: null,
        jobs: {},
        previews: {},
      }),
      ...refOf(info.id),
      state: info.state,
      expiresAt: info.expiresAt ?? existing?.expiresAt ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  async function load(ref: SandboxRef): Promise<SandboxRecord> {
    assertRef(ref);
    const existing = await store.get(ref);
    const info = await backend.get(ref.id);
    const record = recordFrom(info, existing);
    // Never start tracking a sandbox this account cannot see.
    if (existing || info.state !== "terminated") await store.put(record);
    return record;
  }

  async function running(ref: SandboxRef): Promise<SandboxRecord> {
    const record = await load(ref);
    if (record.state === "terminated")
      throw new Error(`Sandbox ${ref.id} no longer exists (deleted or expired).`);
    if (record.state !== "running")
      throw new Error(
        `Sandbox ${ref.id} is ${record.state}.${backend.resume ? " Resume it first." : ""}`,
      );
    return record;
  }

  async function view(
    record: SandboxRecord,
    jobId: string,
    read: { offset?: number; limit?: number; tailBytes?: number },
  ): Promise<JobView> {
    const job = record.jobs[jobId];
    if (!job) throw new Error(`Unknown job ${jobId} for sandbox ${record.id}`);
    const state = await readJobState(backend, record.id, jobId);
    if (!state) throw new Error(`Job ${jobId} was not found in the sandbox`);
    const limit = Math.min(read.limit ?? read.tailBytes ?? DEFAULT_LOG_TAIL_BYTES, 1024 * 1024);
    const offset = read.offset ?? Math.max(0, state.logBytes - limit);
    const bytes =
      state.logBytes > offset
        ? await readJobLog(backend, record.id, jobId, offset, limit)
        : Buffer.alloc(0);
    Object.assign(job, {
      status: state.status,
      exitCode: state.exitCode,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
    });
    await store.put({ ...record, updatedAt: new Date().toISOString() });
    return {
      job,
      state,
      log: {
        text: sanitizeOutput(bytes.toString("utf8"), [...secrets]),
        offset,
        nextOffset: offset + bytes.byteLength,
        totalBytes: state.logBytes,
        truncated: offset > 0 || offset + bytes.byteLength < state.logBytes,
      },
    };
  }

  const api = {
    identity,
    /** Home directory of the command user; the synced project is `projectDir(home)`. */
    home: backend.home,
    capabilities: backend.capabilities,
    limits,
    store,

    async create(input: SandboxCreateOptions): Promise<SandboxRecord> {
      const lifetimeMinutes = input.lifetimeMinutes ?? limits.defaultLifetimeMinutes;
      if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes < 1)
        throw new Error("Lifetime must be a whole number of minutes");
      if (lifetimeMinutes > limits.maxLifetimeMinutes)
        throw new Error(
          `Lifetime ${lifetimeMinutes} min exceeds the approved limit of ${limits.maxLifetimeMinutes} min`,
        );
      const live = (await backend.list()).filter((item) => item.state !== "terminated");
      if (live.length >= limits.maxSandboxes)
        throw new Error(
          `Account ${identity.account} already has ${live.length} live sandbox(es); the approved limit is ${limits.maxSandboxes}. Destroy one first.`,
        );
      const info = await backend.create({
        name: input.name,
        lifetimeMs: lifetimeMinutes * 60_000,
        publicPreviews: input.publicPreviews === true,
        labels: {
          ...(input.purpose ? { gitterm_purpose: input.purpose.slice(0, 120) } : {}),
          ...(input.sessionId ? { gitterm_session: input.sessionId.slice(0, 120) } : {}),
        },
      });
      const record: SandboxRecord = {
        ...recordFrom(info, null),
        name: input.name,
        purpose: input.purpose ?? "",
        project: input.project ?? null,
        sessionId: input.sessionId ?? null,
        publicPreviews: input.publicPreviews === true,
        createdAt: info.createdAt ?? new Date().toISOString(),
      };
      try {
        await store.put(record);
        // The synced project lives here; commands default to it even before the first sync.
        const prepared = await backend.run(info.id, `mkdir -p '${projectDir(backend.home)}'`, {
          timeoutMs: 30_000,
        });
        if (prepared.exitCode !== 0)
          throw new Error("Could not prepare the sandbox project directory");
      } catch (error) {
        // An untracked or unusable sandbox would bill until it expires; remove it instead.
        await backend.destroy(info.id).catch(() => {});
        await store.remove(record).catch(() => {});
        throw error;
      }
      return record;
    },

    /** Local records reconciled with the provider, plus sandboxes this account created elsewhere. */
    async list(): Promise<SandboxRecord[]> {
      const remote = new Map((await backend.list()).map((item) => [item.id, item]));
      const records: SandboxRecord[] = [];
      for (const record of await store.list()) {
        if (
          record.mode !== identity.mode ||
          record.provider !== identity.provider ||
          record.account !== identity.account
        )
          continue;
        const info =
          remote.get(record.id) ??
          (record.state === "terminated" ? null : await backend.get(record.id));
        const next = info ? recordFrom(info, record) : record;
        remote.delete(record.id);
        if (info) await store.put(next);
        records.push(next);
      }
      for (const info of remote.values()) {
        const record = recordFrom(info, null);
        await store.put(record);
        records.push(record);
      }
      return records;
    },

    get: load,

    async sync(ref: SandboxRef, captured: CapturedSource) {
      const record = await running(ref);
      await store.putSnapshot(captured.snapshot);
      const result = await uploadSource(backend, ref.id, captured);
      record.snapshot = {
        id: captured.snapshot.id,
        digest: result.digest,
        syncedAt: new Date().toISOString(),
      };
      await store.put(record);
      return { snapshot: captured.snapshot, verified: result.verified };
    },

    async exec(ref: SandboxRef, input: SandboxExecOptions): Promise<JobView> {
      const record = await running(ref);
      const timeoutMinutes = input.timeoutMinutes ?? Math.min(10, limits.maxJobMinutes);
      if (!(timeoutMinutes > 0) || timeoutMinutes > limits.maxJobMinutes)
        throw new Error(`Job timeout must be between 0 and ${limits.maxJobMinutes} minutes`);
      for (const value of Object.values(input.env ?? {})) secrets.add(value);
      const id = newJobId();
      const cwd = resolveCwd(backend.home, input.cwd);
      record.jobs[id] = {
        id,
        command: input.command,
        cwd,
        snapshotId: record.snapshot?.id ?? null,
        snapshotDigest: record.snapshot?.digest ?? null,
        status: "running",
        exitCode: null,
        startedAt: null,
        finishedAt: null,
        timeoutMs: Math.round(timeoutMinutes * 60_000),
        secretNames: Object.keys(input.env ?? {}),
      };
      // Persist first so a crash after launch still leaves a reattachable record.
      await store.put(record);
      await startJob(backend, ref.id, id, {
        command: input.command,
        cwd,
        timeoutMs: record.jobs[id]!.timeoutMs,
        env: input.env,
      });
      return api.wait(ref, id, input.waitMs ?? 0);
    },

    async wait(
      ref: SandboxRef,
      jobId: string,
      waitMs: number,
      read: { tailBytes?: number } = {},
    ): Promise<JobView> {
      const record = await running(ref);
      const deadline = Date.now() + Math.max(0, waitMs);
      while (true) {
        const result = await view(record, jobId, read);
        if (result.state.status !== "running" || Date.now() >= deadline) return result;
        await sleep(Math.min(2_000, Math.max(250, deadline - Date.now())));
      }
    },

    async job(
      ref: SandboxRef,
      jobId: string,
      read: { offset?: number; limit?: number; tailBytes?: number } = {},
    ) {
      return view(await running(ref), jobId, read);
    },

    async cancel(ref: SandboxRef, jobId: string): Promise<JobView> {
      const record = await running(ref);
      if (!record.jobs[jobId]) throw new Error(`Unknown job ${jobId} for sandbox ${ref.id}`);
      await cancelJob(backend, ref.id, jobId);
      return view(record, jobId, {});
    },

    /** Optionally starts `command` as a job, then waits until the port answers. */
    async preview(
      ref: SandboxRef,
      input: { port: number; command?: string; cwd?: string; readyTimeoutMs?: number },
    ): Promise<PreviewResult> {
      const record = await running(ref);
      if (backend.capabilities.previews === "none")
        throw new Error(`${ref.provider} sandboxes cannot expose ports.`);
      // Some providers only serve public URLs; that needs the public-sharing approval at creation.
      if (backend.capabilities.previews === "public" && !record.publicPreviews)
        throw new Error(
          `${ref.provider} previews are reachable by anyone with the URL. Create the sandbox with publicPreviews to approve that.`,
        );
      let jobId: string | null = null;
      if (input.command) {
        jobId = (
          await api.exec(ref, {
            command: input.command,
            cwd: input.cwd,
            timeoutMinutes: limits.maxJobMinutes,
          })
        ).job.id;
      }
      const access = await backend.preview(ref.id, input.port);
      const deadline = Date.now() + (input.readyTimeoutMs ?? 60_000);
      let ready = false;
      while (!ready && Date.now() < deadline) {
        const status = await fetch(access.url, {
          headers: access.headers,
          redirect: "manual",
          signal: AbortSignal.timeout(5_000),
        })
          .then(async (response) => {
            await response.body?.cancel();
            return response.status;
          })
          .catch(() => 0);
        // The provider edge answers 502 until something listens on the port.
        ready = status > 0 && ![502, 503, 504].includes(status);
        if (!ready) {
          if (jobId) {
            const state = await readJobState(backend, ref.id, jobId);
            if (state && state.status !== "running")
              throw new Error(
                `Preview command exited (${state.status}, exit ${state.exitCode}) before port ${input.port} answered. Read job ${jobId} logs.`,
              );
          }
          await sleep(1_000);
        }
      }
      const unauthenticatedStatus = await fetch(access.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      })
        .then(async (response) => {
          await response.body?.cancel();
          return response.status;
        })
        .catch(() => null);
      record.previews[String(input.port)] = {
        port: input.port,
        jobId,
        url: access.url,
        public: backend.capabilities.previews === "public" || record.publicPreviews,
      };
      await store.put(record);
      return {
        url: access.url,
        port: input.port,
        public: backend.capabilities.previews === "public" || record.publicPreviews,
        headers: access.headers,
        ready,
        unauthenticatedStatus,
        jobId,
      };
    },

    async fetchArtifact(ref: SandboxRef, file: string): Promise<FetchedArtifact> {
      await running(ref);
      return fetchArtifact(backend, ref.id, file);
    },

    async resume(ref: SandboxRef): Promise<SandboxRecord> {
      assertRef(ref);
      if (!backend.resume)
        throw new Error("Direct sandboxes are deleted at their deadline and cannot be resumed.");
      await backend.resume(ref.id);
      return load(ref);
    },

    /** Deletes the sandbox and confirms with the provider that it is gone. */
    async destroy(ref: SandboxRef): Promise<SandboxRecord> {
      assertRef(ref);
      await backend.destroy(ref.id);
      const info = await backend.get(ref.id);
      const existing = await store.get(ref);
      const record = recordFrom(info, existing);
      if (existing) await store.put(record);
      if (info.state !== "terminated")
        throw new Error(
          `The provider still reports sandbox ${ref.id} as ${info.state}. Retry destroy.`,
        );
      return record;
    },
  };
  return api;
}

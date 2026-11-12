import path from "node:path";
import { SandboxProviderError } from "@gitterm/agent-runtime/sandbox/types";
import {
  SandboxAccountError,
  type SandboxBackend,
  type SandboxInfo,
  type SandboxRef,
} from "./backend.js";
import { applyArtifact, fetchArtifact, type FetchedArtifact } from "./artifacts.js";
import {
  assertRedactableSecrets,
  cancelJob,
  newJobId,
  readJobLog,
  readJobState,
  startJob,
  type JobState,
} from "./jobs.js";
import {
  changedSetupFiles,
  createFileSetupSnapshotStore,
  setupFingerprint,
  setupSnapshotName,
  type SetupSnapshotRecord,
  type SetupSnapshotStatus,
  type SetupSnapshotStore,
} from "./setup-snapshots.js";
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
  /** Start from this snapshot, e.g. the project's setup snapshot. */
  snapshot?: string;
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
  /** The conversation that started the job; saved so it can be told when the job finishes. */
  sessionId?: string;
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
  /** The URL to open. */
  url: string;
  port: number;
  public: boolean;
  /** `url` is served by Gitterm; when private, it opens for the owner signed in to Gitterm. */
  viaGitterm: boolean;
  /** Direct provider access, for local proxies. The headers are secret: keep them away from models, logs, and storage. */
  access: { url: string; headers: Record<string, string> };
  ready: boolean;
  /** HTTP status of `url` without credentials (401/403 means access is enforced). */
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
  setupSnapshots?: SetupSnapshotStore;
  limits?: Partial<SandboxLimits>;
}) {
  const { backend } = options;
  const identity = backend.identity;
  const store = options.store ?? createFileSandboxStore();
  const setupSnapshots = options.setupSnapshots ?? createFileSetupSnapshotStore();
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

  const applyInfo = (info: SandboxInfo) => (record: SandboxRecord) => {
    record.state = info.state;
    record.expiresAt = info.expiresAt ?? record.expiresAt;
  };

  async function load(ref: SandboxRef): Promise<SandboxRecord> {
    assertRef(ref);
    const info = await backend.get(ref.id);
    // Never start tracking a sandbox this account cannot see.
    const stored = await store.update(ref, applyInfo(info), () =>
      info.state === "terminated" ? null : recordFrom(info, null),
    );
    return stored ?? recordFrom(info, null);
  }

  /** Resumes a paused sandbox. Where pausing discards files, the synced snapshot is gone too. */
  async function resumeSandbox(
    ref: SandboxRef,
    resume: (id: string) => Promise<void>,
  ): Promise<{ record: SandboxRecord; filesLost: boolean }> {
    await resume(ref.id);
    // Resuming joins a restart already under way, so it may still be starting.
    const record = await settled(ref);
    if (record.state !== "running" || backend.capabilities.pause !== "state-losing")
      return { record, filesLost: false };
    const cleared = await store.update(ref, (stored) => {
      stored.snapshot = null;
    });
    return { record: cleared ?? record, filesLost: true };
  }

  /** Loads the sandbox, waiting while it starts: e.g. a parallel call is resuming it. */
  async function settled(ref: SandboxRef): Promise<SandboxRecord> {
    const deadline = Date.now() + 120_000;
    let record = await load(ref);
    while (record.state === "pending" && Date.now() < deadline) {
      await sleep(1_000);
      record = await load(ref);
    }
    return record;
  }

  /** A sandbox paused for inactivity is resumed on use. `sync` restores files itself. */
  async function running(ref: SandboxRef, use: "sync" | "other" = "other"): Promise<SandboxRecord> {
    let record = await settled(ref);
    if (record.state === "paused" && backend.resume) {
      const resumed = await resumeSandbox(ref, backend.resume);
      record = resumed.record;
      if (resumed.filesLost && use !== "sync")
        throw new Error(
          `Sandbox ${ref.id} was paused and is running again, but ${ref.provider} discards files and processes on pause. Sync again, then retry; earlier jobs cannot be reattached.`,
        );
    }
    if (record.state === "terminated")
      throw new SandboxProviderError(
        "not_found",
        `Sandbox ${ref.id} no longer exists (deleted or expired).`,
      );
    if (record.state !== "running") throw new Error(`Sandbox ${ref.id} is ${record.state}.`);
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
    const progress = {
      status: state.status,
      exitCode: state.exitCode,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
    };
    Object.assign(job, progress);
    await store.update(record, (stored) => {
      if (stored.jobs[jobId]) Object.assign(stored.jobs[jobId], progress);
    });
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

  /** Starts a job. `maxMinutes` bounds its timeout: the job limit, or a preview's sandbox lifetime. */
  async function launchJob(
    ref: SandboxRef,
    input: SandboxExecOptions,
    maxMinutes: number,
  ): Promise<JobView> {
    const record = await running(ref);
    const timeoutMinutes = input.timeoutMinutes ?? Math.min(10, maxMinutes);
    if (!(timeoutMinutes > 0) || timeoutMinutes > maxMinutes)
      throw new Error(`Job timeout must be between 0 and ${maxMinutes} minutes`);
    // Refused before any record is written or anything is sent.
    assertRedactableSecrets(input.env);
    for (const value of Object.values(input.env ?? {})) secrets.add(value);
    const id = newJobId();
    const cwd = resolveCwd(backend.home, input.cwd);
    const job: JobRecord = {
      id,
      command: input.command,
      cwd,
      snapshotId: record.snapshot?.id ?? null,
      snapshotDigest: record.snapshot?.digest ?? null,
      snapshotRoot: record.snapshot?.root ?? null,
      status: "running",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      timeoutMs: Math.round(timeoutMinutes * 60_000),
      secretNames: Object.keys(input.env ?? {}),
      sessionId: input.sessionId ?? null,
    };
    // Persist first so a crash after launch still leaves a reattachable record.
    await store.update(record, (stored) => {
      stored.jobs[id] = job;
    });
    await startJob(backend, ref.id, id, {
      command: input.command,
      cwd,
      timeoutMs: job.timeoutMs,
      env: input.env,
    });
    return api.wait(ref, id, input.waitMs ?? 0);
  }

  const api = {
    identity,
    /** Home directory of the command user; the synced project is `projectDir(home)`. */
    home: backend.home,
    capabilities: backend.capabilities,
    limits,
    store,
    /** Present when the backend pushes job completions; see `SandboxBackend.onJobFinished`. */
    onJobFinished: backend.onJobFinished?.bind(backend),

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
        ...(input.snapshot ? { snapshot: input.snapshot } : {}),
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
        remote.delete(record.id);
        records.push(info ? ((await store.update(record, applyInfo(info))) ?? record) : record);
      }
      for (const info of remote.values()) {
        const record = recordFrom(info, null);
        records.push((await store.update(record, applyInfo(info), () => record)) ?? record);
      }
      return records;
    },

    get: load,

    async sync(ref: SandboxRef, captured: CapturedSource) {
      const record = await running(ref, "sync");
      await store.putSnapshot(captured.snapshot);
      const result = await uploadSource(backend, ref.id, captured);
      await store.update(record, (stored) => {
        stored.snapshot = {
          id: captured.snapshot.id,
          digest: result.digest,
          root: captured.snapshot.root,
          syncedAt: new Date().toISOString(),
        };
      });
      return { snapshot: captured.snapshot, verified: result.verified };
    },

    exec: (ref: SandboxRef, input: SandboxExecOptions) =>
      launchJob(ref, input, limits.maxJobMinutes),

    async wait(
      ref: SandboxRef,
      jobId: string,
      waitMs: number,
      read: { tailBytes?: number } = {},
    ): Promise<JobView> {
      const deadline = Date.now() + Math.max(0, waitMs);
      while (true) {
        const result = await view(await running(ref), jobId, read);
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
        // A preview server lives as long as its sandbox; without a lifetime, as long as any job.
        const minutes = Math.max(
          limits.maxJobMinutes,
          record.expiresAt ? (Date.parse(record.expiresAt) - Date.now()) / 60_000 : 0,
        );
        jobId = (
          await launchJob(
            ref,
            { command: input.command, cwd: input.cwd, timeoutMinutes: minutes },
            minutes,
          )
        ).job.id;
      }
      const { gittermUrl, ...access } = await backend.preview(ref.id, input.port, {
        public: record.publicPreviews,
      });
      const url = gittermUrl ?? access.url;
      // Providers without a public mode keep previews private whatever the sandbox asked for.
      const isPublic =
        backend.capabilities.previews === "public" ||
        (backend.capabilities.previews === "either" && record.publicPreviews);
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
      const unauthenticatedStatus = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      })
        .then(async (response) => {
          await response.body?.cancel();
          return response.status;
        })
        .catch(() => null);
      await store.update(record, (stored) => {
        stored.previews[String(input.port)] = {
          port: input.port,
          jobId,
          url,
          public: isPublic,
        };
      });
      return {
        url,
        port: input.port,
        public: isPublic,
        viaGitterm: Boolean(gittermUrl),
        access,
        ready,
        unauthenticatedStatus,
        jobId,
      };
    },

    /**
     * Downloads a file a job produced. The artifact is recorded with that job, so applying it
     * later checks the checkout against the snapshot the job ran on, not a newer sync.
     */
    async fetchArtifact(
      ref: SandboxRef,
      file: string,
      producedBy: { jobId: string },
    ): Promise<FetchedArtifact & { jobId: string }> {
      const record = await running(ref);
      if (!record.jobs[producedBy.jobId])
        throw new Error(`Unknown job ${producedBy.jobId} for sandbox ${ref.id}`);
      const artifact = await fetchArtifact(backend, ref.id, file);
      await store.update(record, (stored) => {
        stored.artifacts = {
          ...stored.artifacts,
          [artifact.localPath]: {
            localPath: artifact.localPath,
            remotePath: artifact.remotePath,
            sha256: artifact.sha256,
            bytes: artifact.bytes,
            jobId: producedBy.jobId,
            fetchedAt: new Date().toISOString(),
          },
        };
      });
      return { ...artifact, jobId: producedBy.jobId };
    },

    /** Writes a fetched artifact into its job's checkout, refusing stale or escaping targets. */
    async applyArtifact(
      ref: SandboxRef,
      input: {
        localPath: string;
        target: string;
        /** Called with the resolved destination before anything is written, e.g. to ask approval. */
        beforeWrite?: (plan: {
          root: string;
          target: string;
          sha256: string;
          jobId: string;
          snapshotId: string;
        }) => Promise<void>;
      },
    ) {
      assertRef(ref);
      const record = await store.get(ref);
      const artifact = record?.artifacts?.[input.localPath];
      if (!record || !artifact)
        throw new Error("Unknown artifact. Fetch it with the job that produced it first.");
      const job = record.jobs[artifact.jobId];
      if (!job?.snapshotId || !job.snapshotRoot)
        throw new Error(
          `Job ${artifact.jobId} did not run on a synced snapshot, so there is nothing to check the checkout against.`,
        );
      const snapshot = await store.getSnapshot(job.snapshotId, job.snapshotRoot);
      if (!snapshot)
        throw new Error(`Snapshot ${job.snapshotId} manifest is not available locally.`);
      await input.beforeWrite?.({
        root: snapshot.root,
        target: input.target,
        sha256: artifact.sha256,
        jobId: job.id,
        snapshotId: snapshot.id,
      });
      return {
        ...(await applyArtifact({ artifact, snapshot, target: input.target })),
        root: snapshot.root,
        snapshotId: snapshot.id,
        jobId: job.id,
      };
    },

    /** Whether this account's sandboxes can be paused on request (not direct Vercel ones). */
    canPause: !!backend.pause,

    /** Pauses a running sandbox until its next use, which resumes it. */
    async pause(ref: SandboxRef): Promise<SandboxRecord> {
      assertRef(ref);
      if (!backend.pause)
        throw new Error(`${ref.provider} sandboxes on this account cannot be paused.`);
      const record = await settled(ref);
      if (record.state === "paused") return record;
      if (record.state !== "running") throw new Error(`Sandbox ${ref.id} is ${record.state}.`);
      await backend.pause(ref.id);
      return load(ref);
    },

    async resume(ref: SandboxRef): Promise<SandboxRecord> {
      assertRef(ref);
      if (!backend.resume)
        throw new Error(`${ref.provider} sandboxes on this account cannot be resumed.`);
      return (await resumeSandbox(ref, backend.resume)).record;
    },

    /** How saving a snapshot affects the sandbox, or null where this account cannot snapshot. */
    snapshotEffect: backend.snapshots?.effect ?? null,

    /**
     * This account's setup snapshots, newest first. With `project`, only those tied to that
     * checkout or to none, each with the dependency files changed since it was saved.
     */
    async setupSnapshots(project?: string): Promise<SetupSnapshotStatus[]> {
      const records = (await setupSnapshots.list(identity)).filter(
        (record) => !project || record.project === null || record.project === project,
      );
      return Promise.all(
        records.map(async (record) => ({
          record,
          changed: record.project
            ? changedSetupFiles(record.fingerprint, await setupFingerprint(record.project))
            : [],
        })),
      );
    },

    /**
     * Snapshots the sandbox. `project` ties it to a checkout, whose dependency files are then
     * watched for changes; `replace` names a snapshot to delete once this one is saved. Where
     * the provider stops the sandbox to snapshot it (Vercel), the sandbox is gone after.
     */
    async saveSetupSnapshot(
      ref: SandboxRef,
      input: { label: string; project?: string | null; note?: string; replace?: string },
    ): Promise<{ record: SetupSnapshotRecord; replaced: string | null; leftover: string | null }> {
      assertRef(ref);
      if (!backend.snapshots)
        throw new Error(
          `${identity.mode === "managed" ? "Managed accounts" : `${identity.provider} sandboxes`} cannot be snapshotted.`,
        );
      const previous = input.replace
        ? (await setupSnapshots.list(identity)).find(
            (record) => record.snapshotId === input.replace,
          )
        : undefined;
      if (input.replace && !previous) throw new Error(`No saved snapshot ${input.replace}.`);
      await running(ref);
      const project = input.project ?? null;
      const fingerprint = project ? await setupFingerprint(project) : {};
      const snapshotId = await backend.snapshots.create(
        ref.id,
        setupSnapshotName(input.label, project),
      );
      const record: SetupSnapshotRecord = {
        ...identity,
        snapshotId,
        label: input.label.slice(0, 60),
        project,
        note: input.note?.slice(0, 500) ?? "",
        fingerprint,
        sandboxId: ref.id,
        createdAt: new Date().toISOString(),
      };
      await setupSnapshots.put(record);
      if (backend.snapshots.effect === "stops") await load(ref).catch(() => {});
      let leftover: string | null = null;
      if (previous && previous.snapshotId !== snapshotId) {
        await setupSnapshots.remove(identity, previous.snapshotId);
        await backend.snapshots.delete(previous.snapshotId).catch(() => {
          leftover = previous.snapshotId;
        });
      }
      return { record, replaced: previous?.snapshotId ?? null, leftover };
    },

    /** Deletes a setup snapshot from the provider and forgets it. */
    async deleteSetupSnapshot(snapshotId: string): Promise<SetupSnapshotRecord> {
      const record = (await setupSnapshots.list(identity)).find(
        (item) => item.snapshotId === snapshotId,
      );
      if (!record) throw new Error(`No saved snapshot ${snapshotId}.`);
      if (!backend.snapshots) throw new Error("This account cannot delete snapshots.");
      await backend.snapshots.delete(snapshotId);
      await setupSnapshots.remove(identity, snapshotId);
      return record;
    },

    /** Deletes the sandbox and confirms with the provider that it is gone. */
    async destroy(ref: SandboxRef): Promise<SandboxRecord> {
      assertRef(ref);
      await backend.destroy(ref.id);
      // Some providers accept a deletion and finish it later; wait for it, within a bound.
      let info = await backend.get(ref.id);
      for (
        const deadline = Date.now() + 30_000;
        info.state !== "terminated" && Date.now() < deadline;
      ) {
        await sleep(2_000);
        info = await backend.get(ref.id);
      }
      const record = (await store.update(ref, applyInfo(info))) ?? recordFrom(info, null);
      if (info.state !== "terminated")
        throw new Error(
          `The provider still reports sandbox ${ref.id} as ${info.state}. Retry destroy.`,
        );
      return record;
    },
  };
  return api;
}

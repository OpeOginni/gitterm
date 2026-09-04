import { randomUUID } from "node:crypto";
import { and, db, eq, inArray } from "@gitterm/db";
import { agentRun, type AgentRun } from "@gitterm/db/schema/agent-run";
import { RUN_LIFECYCLE_EVENTS } from "../../events/run-lifecycle";
import { recordWorkspaceActivity } from "../workspace-activity";
import {
  acquireWatcherLease,
  INSTANCE_ID,
  onWatchControl,
  publishWatchControl,
  releaseWatcherLease,
  renewWatcherLease,
} from "./cluster";
import { publicRun } from "./public";
import {
  ACTIVE_RUN_STATUSES,
  deriveRunState,
  getRuntime,
  isTerminalRunStatus,
  type OpencodeRuntime,
  type RuntimeSignal,
} from "./runtime";
import { getRuntimeTargetForWorkspace } from "./target";

const HEARTBEAT_MS = 30_000;
const INACTIVITY_PROBE_MS = 60_000;
const CHANGE_DEBOUNCE_MS = 1_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SWEEP_MS = 30_000;

export const WORKSPACE_STOPPED_MESSAGE = "Workspace stopped before the run completed";
export const WORKSPACE_PAUSED_AWAITING_INPUT_MESSAGE = "Workspace paused while waiting for input";

type TrackableRun = Pick<
  AgentRun,
  "id" | "nativeSessionId" | "nativeMessageId" | "submittedAt" | "status" | "pendingInputs"
>;

/**
 * What callers get from `ensureWorkspaceWatcher`: the local watcher when this
 * replica owns the workspace, otherwise a proxy that forwards to the owner.
 */
export interface RunWatcherHandle {
  readonly local: boolean;
  track(run: TrackableRun): void;
  untrack(runId: string): void;
  /** Re-read a run right after a reply so callers see the new status. */
  resolveInput(runId: string, requestId: string): Promise<void>;
}

type TrackedRun = {
  id: string;
  sessionId: string;
  messageId: string;
  submittedAt: Date | null;
  status: string;
  pendingInputs: string;
  sessionError: string | null;
  lastRun: string | null;
  debounce: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<void> | null;
  dirty: boolean;
};

function log(level: "info" | "warn", message: string, context: Record<string, unknown>) {
  console[level](`[run-watcher] ${message}`, context);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stoppedWorkspaceMessage(status: string): string {
  return status === "awaiting_input"
    ? WORKSPACE_PAUSED_AWAITING_INPUT_MESSAGE
    : WORKSPACE_STOPPED_MESSAGE;
}

/**
 * Holds one OpenCode event stream per workspace with active runs and keeps
 * those runs' rows current. Events only tell it *which* session changed; the
 * authoritative state always comes from `runtime.snapshot()`, so a missed or
 * reordered event costs at most one extra fetch, never a wrong status.
 *
 * The watcher is the sole writer of active run rows apart from cancel/fail,
 * which win via the `status IN (active)` guard on every update here.
 */
/**
 * The answered request is removed from the row directly when no live watcher
 * can re-read the session, so the run isn't left stuck on it.
 */
async function dropAnsweredInput(runId: string, requestId: string): Promise<void> {
  const [row] = await db.select().from(agentRun).where(eq(agentRun.id, runId)).limit(1);
  if (!row || row.status !== "awaiting_input") return;
  const remaining = row.pendingInputs.filter((request) => request.id !== requestId);
  const [updated] = await db
    .update(agentRun)
    .set({
      pendingInputs: remaining,
      status: remaining.length > 0 ? "awaiting_input" : "running",
      updatedAt: new Date(),
    })
    .where(and(eq(agentRun.id, runId), eq(agentRun.status, "awaiting_input")))
    .returning();
  if (updated) {
    RUN_LIFECYCLE_EVENTS.publish(runId, { type: "run.updated", run: publicRun(updated) });
  }
}

export class WorkspaceWatcher implements RunWatcherHandle {
  readonly local = true;
  /** Unique per watcher, so a retired watcher cannot release its replacement's lease. */
  private readonly leaseId: string;
  private readonly tracked = new Map<string, TrackedRun>();
  private readonly bySession = new Map<string, TrackedRun>();
  private runtime: OpencodeRuntime | null = null;
  private connected = false;
  private stopped = false;
  private abort: AbortController | null = null;
  private lastSignalAt = Date.now();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly probe: ReturnType<typeof setInterval>;

  constructor(
    readonly workspaceId: string,
    leaseId: string,
  ) {
    this.leaseId = leaseId;
    this.heartbeat = setInterval(() => void this.keepAlive(), HEARTBEAT_MS);
    this.probe = setInterval(() => this.probeInactivity(), INACTIVITY_PROBE_MS / 4);
    void this.loop();
  }

  track(run: TrackableRun) {
    if (!run.nativeSessionId || this.tracked.has(run.id) || this.stopped) return;
    const tracked: TrackedRun = {
      id: run.id,
      sessionId: run.nativeSessionId,
      messageId: run.nativeMessageId,
      submittedAt: run.submittedAt,
      status: run.status,
      pendingInputs: JSON.stringify(run.pendingInputs),
      sessionError: null,
      lastRun: null,
      debounce: null,
      refreshing: null,
      dirty: false,
    };
    this.tracked.set(run.id, tracked);
    this.bySession.set(tracked.sessionId, tracked);
    if (this.connected) void this.refresh(tracked);
  }

  untrack(runId: string) {
    const tracked = this.tracked.get(runId);
    if (!tracked) return;
    if (tracked.debounce) clearTimeout(tracked.debounce);
    this.tracked.delete(runId);
    if (this.bySession.get(tracked.sessionId) === tracked) this.bySession.delete(tracked.sessionId);
    if (this.tracked.size === 0) this.stop();
  }

  async resolveInput(runId: string, requestId: string): Promise<void> {
    const tracked = this.tracked.get(runId);
    if (tracked && this.connected) {
      await this.refresh(tracked);
      return;
    }
    await dropAnsweredInput(runId, requestId);
  }

  /** Re-snapshot one run now (another replica answered or cancelled it). */
  refreshRun(runId: string) {
    const tracked = this.tracked.get(runId);
    if (tracked && this.connected) void this.refresh(tracked);
  }

  private stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.abort?.abort();
    clearInterval(this.heartbeat);
    clearInterval(this.probe);
    for (const tracked of this.tracked.values()) {
      if (tracked.debounce) clearTimeout(tracked.debounce);
    }
    if (watchers.get(this.workspaceId) === this) watchers.delete(this.workspaceId);
    void releaseWatcherLease(this.workspaceId, this.leaseId);
  }

  private async loop() {
    let backoff = RECONNECT_MIN_MS;
    while (!this.stopped) {
      let lookup: Awaited<ReturnType<typeof getRuntimeTargetForWorkspace>>;
      try {
        lookup = await getRuntimeTargetForWorkspace(this.workspaceId);
      } catch (error) {
        log("warn", "failed to resolve workspace runtime", {
          workspaceId: this.workspaceId,
          error,
        });
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
        continue;
      }
      if (lookup.kind === "unavailable") {
        await this.workspaceUnavailable();
        return;
      }
      const runtime = getRuntime(lookup.target);
      this.abort = new AbortController();
      try {
        for await (const signal of runtime.subscribe(this.abort.signal)) {
          if (this.stopped) break;
          this.lastSignalAt = Date.now();
          if (signal.type === "connected") {
            this.runtime = runtime;
            this.connected = true;
            backoff = RECONNECT_MIN_MS;
            for (const tracked of this.tracked.values()) void this.refresh(tracked);
            continue;
          }
          this.handle(signal);
        }
      } catch (error) {
        if (!this.stopped && !this.abort.signal.aborted) {
          log("warn", "event stream failed", { workspaceId: this.workspaceId, error });
        }
      }
      this.connected = false;
      if (this.stopped) return;
      if (this.tracked.size === 0) {
        this.stop();
        return;
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    }
  }

  private handle(signal: RuntimeSignal) {
    if (signal.type === "connected") return;
    const tracked = this.bySession.get(signal.sessionId);
    if (!tracked) return;
    if (signal.type === "session.error") tracked.sessionError = signal.message;
    if (signal.type === "session.changed") {
      if (!tracked.debounce) {
        tracked.debounce = setTimeout(() => {
          tracked.debounce = null;
          void this.refresh(tracked);
        }, CHANGE_DEBOUNCE_MS);
      }
      return;
    }
    if (tracked.debounce) {
      clearTimeout(tracked.debounce);
      tracked.debounce = null;
    }
    void this.refresh(tracked);
  }

  /** Snapshot → derive → persist, serialized per run so writes never reorder. */
  private refresh(tracked: TrackedRun): Promise<void> {
    if (tracked.refreshing) {
      tracked.dirty = true;
      return tracked.refreshing;
    }
    tracked.refreshing = this.doRefresh(tracked)
      .catch((error) => {
        log("warn", "refresh failed", { workspaceId: this.workspaceId, runId: tracked.id, error });
      })
      .finally(() => {
        tracked.refreshing = null;
        if (tracked.dirty && this.tracked.has(tracked.id)) {
          tracked.dirty = false;
          void this.refresh(tracked);
        }
      });
    return tracked.refreshing;
  }

  private async doRefresh(tracked: TrackedRun) {
    const runtime = this.runtime;
    if (!runtime || !this.tracked.has(tracked.id)) return;
    const snapshot = await runtime.snapshot(tracked.sessionId, tracked.messageId);
    if (!this.tracked.has(tracked.id)) return;
    const derived = deriveRunState(snapshot, {
      submittedAt: tracked.submittedAt,
      sessionError: tracked.sessionError,
    });
    const pendingInputs = JSON.stringify(snapshot.pendingInputs);
    // Message/token events are useful for the native OpenCode stream, but they
    // are not GitTerm lifecycle changes. Avoid rewriting the row for each one.
    if (derived.status === tracked.status && pendingInputs === tracked.pendingInputs) return;
    const terminal = isTerminalRunStatus(derived.status);
    const [updated] = await db
      .update(agentRun)
      .set({
        status: derived.status,
        errorMessage: derived.errorMessage,
        finalText: snapshot.finalText,
        messages: snapshot.messages,
        pendingInputs: terminal ? [] : snapshot.pendingInputs,
        completedAt: terminal ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(agentRun.id, tracked.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
      .returning();
    if (!updated) {
      // Cancelled or failed by someone else while we were reading.
      const [row] = await db.select().from(agentRun).where(eq(agentRun.id, tracked.id)).limit(1);
      if (row) {
        RUN_LIFECYCLE_EVENTS.publish(tracked.id, { type: "run.updated", run: publicRun(row) });
      }
      this.untrack(tracked.id);
      return;
    }
    const run = publicRun(updated);
    const serializedRun = JSON.stringify(run);
    if (serializedRun !== tracked.lastRun) {
      tracked.lastRun = serializedRun;
      RUN_LIFECYCLE_EVENTS.publish(tracked.id, { type: "run.updated", run });
    }
    tracked.status = updated.status;
    tracked.pendingInputs = JSON.stringify(updated.pendingInputs);
    if (terminal) this.untrack(tracked.id);
  }

  /** The workspace is no longer running: every tracked run is over. */
  private async workspaceUnavailable() {
    for (const tracked of Array.from(this.tracked.values())) {
      const [updated] = await db
        .update(agentRun)
        .set({
          status: "cancelled",
          errorMessage: stoppedWorkspaceMessage(tracked.status),
          pendingInputs: [],
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(agentRun.id, tracked.id), inArray(agentRun.status, [...ACTIVE_RUN_STATUSES])))
        .returning()
        .catch(() => [] as AgentRun[]);
      if (updated) {
        RUN_LIFECYCLE_EVENTS.publish(tracked.id, {
          type: "run.updated",
          run: publicRun(updated),
        });
      }
      this.untrack(tracked.id);
    }
    this.stop();
  }

  private async keepAlive() {
    if (this.stopped) return;
    if (!(await renewWatcherLease(this.workspaceId, this.leaseId))) {
      log("info", "lease taken over by another replica; stopping watcher", {
        workspaceId: this.workspaceId,
      });
      this.stop();
      return;
    }
    const working = [...this.tracked.values()].some(
      (tracked) => tracked.status === "running" || tracked.status === "retrying",
    );
    if (!working) return;
    await recordWorkspaceActivity(this.workspaceId).catch((error) => {
      log("warn", "keep-alive failed", { workspaceId: this.workspaceId, error });
    });
  }

  private probeInactivity() {
    if (this.stopped || !this.connected || this.tracked.size === 0) return;
    if (Date.now() - this.lastSignalAt < INACTIVITY_PROBE_MS) return;
    this.lastSignalAt = Date.now();
    for (const tracked of this.tracked.values()) void this.refresh(tracked);
  }
}

const watchers = new Map<string, WorkspaceWatcher>();
const ensuring = new Map<string, Promise<RunWatcherHandle>>();

/** Forwards to whichever replica holds the workspace's lease. */
class RemoteWatcherHandle implements RunWatcherHandle {
  readonly local = false;
  constructor(readonly workspaceId: string) {}
  track(run: TrackableRun) {
    publishWatchControl({ type: "track", workspaceId: this.workspaceId, runId: run.id });
  }
  untrack(runId: string) {
    publishWatchControl({ type: "untrack", workspaceId: this.workspaceId, runId });
  }
  async resolveInput(runId: string, requestId: string) {
    publishWatchControl({ type: "refresh", workspaceId: this.workspaceId, runId });
    await dropAnsweredInput(runId, requestId);
  }
}

/**
 * Get the watcher for a workspace: this replica's if it holds (or can take) the
 * lease, otherwise a proxy to the owner. Concurrent callers share one attempt.
 */
export function ensureWorkspaceWatcher(workspaceId: string): Promise<RunWatcherHandle> {
  const local = watchers.get(workspaceId);
  if (local) return Promise.resolve(local);
  const inFlight = ensuring.get(workspaceId);
  if (inFlight) return inFlight;
  const attempt = (async (): Promise<RunWatcherHandle> => {
    const leaseId = `${INSTANCE_ID}:${randomUUID()}`;
    if (!(await acquireWatcherLease(workspaceId, leaseId))) {
      return new RemoteWatcherHandle(workspaceId);
    }
    let watcher = watchers.get(workspaceId);
    if (!watcher) {
      watcher = new WorkspaceWatcher(workspaceId, leaseId);
      watchers.set(workspaceId, watcher);
    } else {
      // Another local caller installed a watcher while the lease request was in flight.
      void releaseWatcherLease(workspaceId, leaseId);
    }
    return watcher;
  })().finally(() => ensuring.delete(workspaceId));
  ensuring.set(workspaceId, attempt);
  return attempt;
}

export function getWorkspaceWatcher(workspaceId: string): WorkspaceWatcher | undefined {
  return watchers.get(workspaceId);
}

/** Stop tracking a run wherever its watcher lives. */
export function untrackRun(workspaceId: string, runId: string) {
  const local = watchers.get(workspaceId);
  if (local) local.untrack(runId);
  else publishWatchControl({ type: "untrack", workspaceId, runId });
}

async function loadTrackableRun(runId: string): Promise<TrackableRun | undefined> {
  const [row] = await db
    .select({
      id: agentRun.id,
      nativeSessionId: agentRun.nativeSessionId,
      nativeMessageId: agentRun.nativeMessageId,
      submittedAt: agentRun.submittedAt,
      status: agentRun.status,
      pendingInputs: agentRun.pendingInputs,
    })
    .from(agentRun)
    .where(eq(agentRun.id, runId))
    .limit(1);
  return row;
}

let controlSubscribed = false;
function subscribeToWatchControl() {
  if (controlSubscribed) return;
  controlSubscribed = true;
  onWatchControl((message) => {
    const watcher = watchers.get(message.workspaceId);
    if (!watcher) return;
    switch (message.type) {
      case "track":
        void loadTrackableRun(message.runId).then((row) => {
          if (row && row.nativeSessionId) watcher.track(row);
        });
        break;
      case "untrack":
        watcher.untrack(message.runId);
        break;
      case "refresh":
        watcher.refreshRun(message.runId);
        break;
    }
  });
}

/**
 * Make sure every active run is watched by some replica. Runs once at boot to
 * re-attach after a restart, then periodically so a lease dropped by a dead
 * replica is picked up within one sweep plus the lease TTL.
 */
async function sweepActiveRuns(): Promise<void> {
  const rows = await db
    .select({
      id: agentRun.id,
      workspaceId: agentRun.workspaceId,
      nativeSessionId: agentRun.nativeSessionId,
      nativeMessageId: agentRun.nativeMessageId,
      submittedAt: agentRun.submittedAt,
      status: agentRun.status,
      pendingInputs: agentRun.pendingInputs,
    })
    .from(agentRun)
    .where(inArray(agentRun.status, ["running", "retrying", "awaiting_input"]));
  const byWorkspace = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.nativeSessionId) continue;
    const group = byWorkspace.get(row.workspaceId) ?? [];
    group.push(row);
    byWorkspace.set(row.workspaceId, group);
  }
  let owned = 0;
  for (const [workspaceId, runs] of byWorkspace) {
    const handle = await ensureWorkspaceWatcher(workspaceId);
    if (!handle.local) continue;
    owned += 1;
    for (const run of runs) handle.track(run);
  }
  if (rows.length > 0) {
    log("info", "swept active runs", { runs: rows.length, workspaces: byWorkspace.size, owned });
  }
}

let sweeping: ReturnType<typeof setInterval> | null = null;

/** Start cross-replica coordination for this process; idempotent. */
export function startRunWatcherSweep(): void {
  if (sweeping) return;
  RUN_LIFECYCLE_EVENTS.bridge();
  subscribeToWatchControl();
  const run = () => sweepActiveRuns().catch((error) => log("warn", "sweep failed", { error }));
  void run();
  sweeping = setInterval(run, SWEEP_MS);
}

import { randomUUID } from "node:crypto";
import { and, db, eq, inArray, sql } from "@gitterm/db";
import { agentRun } from "@gitterm/db/schema/agent-run";
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
import {
  ACTIVE_RUN_STATUSES,
  deriveRunState,
  getRuntime,
  isTerminalRunStatus,
  type OpencodeRuntime,
  type RuntimeSignal,
} from "@gitterm/agent-runtime";
import {
  loadRun,
  publishRun,
  settleRun,
  sleep,
  trackableRunColumns,
  type TrackableRun,
} from "./store";
import { getRuntimeTargetForWorkspace } from "./target";

const HEARTBEAT_MS = 30_000;
const INACTIVITY_PROBE_MS = 60_000;
const CHANGE_DEBOUNCE_MS = 1_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SWEEP_MS = 30_000;

const WATCHED_STATUSES = ACTIVE_RUN_STATUSES.filter((status) => status !== "pending");

export function stoppedWorkspaceMessage(status: string): string {
  return status === "awaiting_input"
    ? "Workspace paused while waiting for input"
    : "Workspace stopped before the run completed";
}

/** The local watcher when this replica holds the lease, otherwise a proxy to the owner. */
export interface RunWatcherHandle {
  readonly local: boolean;
  track(run: TrackableRun): void;
  untrack(runId: string): void;
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
  debounce: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<void> | null;
  dirty: boolean;
};

function log(level: "info" | "warn", message: string, context: Record<string, unknown>) {
  console[level](`[run-watcher] ${message}`, context);
}

/** For when no live watcher can re-read the session. */
async function dropAnsweredInput(runId: string, requestId: string): Promise<void> {
  // Compute from the locked row in UPDATE, not a stale read: parallel replies
  // must not restore one another's already-answered requests.
  const remaining = sql`coalesce((select jsonb_agg(item) from jsonb_array_elements(${agentRun.pendingInputs}) item where item->>'id' <> ${requestId}), '[]'::jsonb)`;
  const [updated] = await db
    .update(agentRun)
    .set({
      pendingInputs: remaining,
      status: sql`case when jsonb_array_length(${remaining}) > 0 then 'awaiting_input'::agent_run_status else 'running'::agent_run_status end`,
      updatedAt: new Date(),
    })
    .where(and(eq(agentRun.id, runId), eq(agentRun.status, "awaiting_input")))
    .returning();
  if (updated) publishRun(updated);
}

/**
 * One OpenCode event stream per workspace with active runs. Events only say which
 * session changed; state always comes from `runtime.snapshot()`, so a missed event
 * costs one extra fetch, never a wrong status. Cancel/fail win via the ACTIVE guard.
 */
class WorkspaceWatcher implements RunWatcherHandle {
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

  isTracking(runId: string): boolean {
    return this.tracked.has(runId);
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
      await dropAnsweredInput(runId, requestId);
      return;
    }
    await dropAnsweredInput(runId, requestId);
  }

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

  private handle(signal: Exclude<RuntimeSignal, { type: "connected" }>) {
    const tracked = this.bySession.get(signal.sessionId);
    if (!tracked) return;
    if (signal.type === "session.error") tracked.sessionError = signal.message;
    if (signal.type === "session.changed") {
      // Message/part updates arrive in bursts; one snapshot per burst is enough.
      tracked.debounce ??= setTimeout(() => {
        tracked.debounce = null;
        void this.refresh(tracked);
      }, CHANGE_DEBOUNCE_MS);
      return;
    }
    if (tracked.debounce) {
      clearTimeout(tracked.debounce);
      tracked.debounce = null;
    }
    void this.refresh(tracked);
  }

  /** Serialized per run so writes never reorder. */
  private refresh(tracked: TrackedRun): Promise<void> {
    if (tracked.refreshing) {
      tracked.dirty = true;
      return tracked.refreshing;
    }
    tracked.refreshing = (async () => {
      do {
        tracked.dirty = false;
        await this.doRefresh(tracked);
      } while (tracked.dirty && this.tracked.has(tracked.id));
    })()
      .catch((error) => {
        log("warn", "refresh failed", { workspaceId: this.workspaceId, runId: tracked.id, error });
      })
      .finally(() => {
        tracked.refreshing = null;
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
    // Only lifecycle changes are persisted; message and token churn stays in OpenCode.
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
      const row = await loadRun(tracked.id);
      if (row) publishRun(row);
      this.untrack(tracked.id);
      return;
    }
    publishRun(updated);
    tracked.status = updated.status;
    tracked.pendingInputs = JSON.stringify(updated.pendingInputs);
    if (terminal) this.untrack(tracked.id);
  }

  private async workspaceUnavailable() {
    for (const tracked of Array.from(this.tracked.values())) {
      await settleRun(tracked.id, {
        status: "cancelled",
        errorMessage: stoppedWorkspaceMessage(tracked.status),
      }).catch((error) => {
        log("warn", "failed to settle run", { runId: tracked.id, error });
      });
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

/** Concurrent callers share one lease attempt. */
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
    const watcher = new WorkspaceWatcher(workspaceId, leaseId);
    watchers.set(workspaceId, watcher);
    return watcher;
  })().finally(() => ensuring.delete(workspaceId));
  ensuring.set(workspaceId, attempt);
  return attempt;
}

export function untrackRun(workspaceId: string, runId: string) {
  const local = watchers.get(workspaceId);
  if (local) local.untrack(runId);
  else publishWatchControl({ type: "untrack", workspaceId, runId });
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
        if (watcher.isTracking(message.runId)) break;
        void db
          .select(trackableRunColumns)
          .from(agentRun)
          .where(eq(agentRun.id, message.runId))
          .limit(1)
          .then(([row]) => {
            if (row) watcher.track(row);
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

/** Re-attaches after a restart and picks up leases dropped by dead replicas. */
async function sweepActiveRuns(): Promise<void> {
  const rows = await db
    .select(trackableRunColumns)
    .from(agentRun)
    .where(inArray(agentRun.status, WATCHED_STATUSES));
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

export function startRunWatcherSweep(): void {
  if (sweeping) return;
  RUN_LIFECYCLE_EVENTS.bridge();
  subscribeToWatchControl();
  const run = () => sweepActiveRuns().catch((error) => log("warn", "sweep failed", { error }));
  void run();
  sweeping = setInterval(run, SWEEP_MS);
}

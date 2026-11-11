import type { OpenCodeClient } from "@opencode/client";
import type { GittermClient } from "@gitterm/sdk";
import { markCloudSession, runtimeClient, type HandoffRecord } from "./handoff";
import type { CloudStatus } from "./marker";

/**
 * How often a cloud session is looked at: soon while its agent works or its status is not
 * known yet, rarely otherwise.
 */
const WORKING_POLL_MS = 5_000;
const RESTING_POLL_MS = 20_000;
const FIRST_POLL_MS = 2_000;

/**
 * What the cloud side of a session is doing right now. Every request to the workspace is
 * marked passive, and a workspace that is not running is never woken, so asking does not
 * cost anything or keep the workspace from pausing.
 */
export async function cloudStatus(
  gitterm: GittermClient,
  record: HandoffRecord,
  signal: AbortSignal,
): Promise<CloudStatus> {
  const workspace = await gitterm.workspaces.get(record.workspaceID!);
  if (workspace.status === "terminated") return "gone";
  if (workspace.status !== "running") return "paused";
  const remote = runtimeClient(await gitterm.workspaces.getRuntimeAccess(workspace.id), {
    passive: true,
  });
  const { sessionID } = record;
  const [active, permissions, forms] = await Promise.all([
    remote.session.active({ signal }),
    remote.permission.list({ sessionID }, { signal }),
    remote.session.form.list({ sessionID }, { signal }),
  ]);
  // An agent that asked something is "active" too, but it is the user it is waiting for.
  if (permissions.length > 0 || forms.length > 0) return "waiting";
  return active[sessionID] ? "working" : "idle";
}

/**
 * Keeps the marker on each local session up to date with what its cloud side is doing, for
 * as long as there are sessions in the cloud. `sessions` is read on every round. Returns
 * when none are left or on abort.
 */
export async function watchCloudSessions(deps: {
  gitterm(): GittermClient;
  local(): Promise<OpenCodeClient>;
  sessions(): HandoffRecord[];
  /** Whether a command is working on the session right now; it is left alone meanwhile. */
  busy(sessionID: string): boolean;
  /** Called once when a session's workspace turns out to be deleted. */
  gone(record: HandoffRecord): Promise<void>;
  signal: AbortSignal;
  /** Waits between rounds; it may return early, for instance when a session is added. */
  pause(milliseconds: number): Promise<void>;
}) {
  const { signal } = deps;
  const known = new Map<string, CloudStatus>();
  while (!signal.aborted && deps.sessions().length > 0) {
    for (const record of deps.sessions()) {
      if (deps.busy(record.sessionID)) continue;
      // A failed look (offline, GitTerm unreachable) changes nothing; the next round retries.
      const status = await cloudStatus(deps.gitterm(), record, signal).catch(() => undefined);
      if (!status || status === known.get(record.sessionID)) continue;
      // The session may have come back or moved on while this was in flight.
      if (!deps.sessions().includes(record) || deps.busy(record.sessionID)) continue;
      const marked = await deps
        .local()
        .then((local) =>
          markCloudSession(
            local,
            record.sessionID,
            { workspaceID: record.workspaceID!, status },
            signal,
          ),
        )
        .then(
          () => true,
          () => false,
        );
      if (!marked) continue;
      known.set(record.sessionID, status);
      if (status === "gone") await deps.gone(record).catch(() => {});
    }
    const statuses = deps.sessions().map((record) => known.get(record.sessionID));
    const wait = statuses.includes(undefined)
      ? FIRST_POLL_MS
      : statuses.includes("working")
        ? WORKING_POLL_MS
        : RESTING_POLL_MS;
    await deps.pause(wait);
  }
}

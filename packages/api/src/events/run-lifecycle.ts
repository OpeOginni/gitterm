import { EventEmitter } from "node:events";
import {
  onRemoteRunLifecycleEvent,
  publishRunLifecycleEventRemote,
} from "../service/agent-run/cluster";
import type { PublicAgentRun } from "../service/agent-run/public";

/** Minimal lifecycle signal used by push-based waits. Native execution events stay in OpenCode. */
export type RunEvent = { type: "run.updated"; run: PublicAgentRun };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let bridged = false;
/** Start receiving events published by other replicas; idempotent. */
function bridgeRemoteEvents() {
  if (bridged) return;
  bridged = true;
  onRemoteRunLifecycleEvent<{ runId: string; event: RunEvent }>(({ runId, event }) => {
    emitter.emit(runId, event);
  });
}

/**
 * Fan-out from the run watcher to lifecycle subscribers. Local listeners are
 * notified directly; the event is also published over Redis so subscribers
 * attached to other `apps/server` replicas receive it.
 */
export const RUN_LIFECYCLE_EVENTS = {
  publish(runId: string, event: RunEvent) {
    emitter.emit(runId, event);
    publishRunLifecycleEventRemote({ runId, event });
  },
  /** For `on(emitter, runId)` style consumers; call `bridge()` first. */
  emitter,
  bridge: bridgeRemoteEvents,
};

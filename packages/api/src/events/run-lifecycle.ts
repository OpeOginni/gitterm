import { EventEmitter } from "node:events";
import {
  onRemoteRunLifecycleEvent,
  publishRunLifecycleEventRemote,
} from "../service/agent-run/cluster";
import type { PublicAgentRun } from "../service/agent-run/public";

export type RunEvent = { type: "run.updated"; run: PublicAgentRun };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let bridged = false;
function bridgeRemoteEvents() {
  if (bridged) return;
  bridged = true;
  onRemoteRunLifecycleEvent<{ runId: string; event: RunEvent }>(({ runId, event }) => {
    emitter.emit(runId, event);
  });
}

/** Emits locally and publishes over Redis so subscribers on other replicas receive it. */
export const RUN_LIFECYCLE_EVENTS = {
  publish(runId: string, event: RunEvent) {
    emitter.emit(runId, event);
    publishRunLifecycleEventRemote({ runId, event });
  },
  emitter,
  bridge: bridgeRemoteEvents,
};

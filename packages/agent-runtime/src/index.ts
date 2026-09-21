import { createV2Runtime } from "./v2";
import type { OpencodeRuntime, RuntimeTarget } from "./types";

export function getRuntime(target: RuntimeTarget): OpencodeRuntime {
  return createV2Runtime(target);
}

export { parseModelRef } from "./types";
export type {
  OpencodeRuntime,
  PermissionReply,
  QuestionInputRequest,
  RuntimeSignal,
  RuntimeSnapshot,
  RuntimeTarget,
} from "./types";
export {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  deriveRunState,
  isActiveRunStatus,
  isTerminalRunStatus,
  type AgentRunStatus,
} from "./derive";

import type { OpencodeApi } from "@gitterm/db/schema/workspace";
import { createV1Runtime } from "./v1";
import { createV2Runtime } from "./v2";
import type { OpencodeRuntime, RuntimeTarget } from "./types";

/** OpenCode API generation for workspaces that don't choose one. Flip to "v2" once OpenCode 2 is the shipped default. */
export const DEFAULT_OPENCODE_API: OpencodeApi = "v1";

export function getRuntime(target: RuntimeTarget): OpencodeRuntime {
  return target.api === "v2" ? createV2Runtime(target) : createV1Runtime(target);
}

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

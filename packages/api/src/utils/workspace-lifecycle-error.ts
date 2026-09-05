import { TRPCError } from "@trpc/server";

/** Machine-readable lifecycle failures, separate from tRPC's transport code. */
export class WorkspaceLifecycleTRPCError extends TRPCError {
  constructor(
    readonly workspaceLifecycleCode:
      | "WORKSPACE_NOT_RUNNING"
      | "WORKSPACE_TERMINATED"
      | "WORKSPACE_START_TIMEOUT",
    message: string,
    code: "BAD_REQUEST" | "TIMEOUT" = "BAD_REQUEST",
  ) {
    // Keep the prefix for SDK versions that predate structured error data.
    super({ code, message: `${workspaceLifecycleCode}: ${message}` });
  }
}

export type GittermErrorCode =
  | "NOT_LOGGED_IN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "NETWORK"
  | WorkspaceLifecycleErrorCode;

export type WorkspaceLifecycleErrorCode =
  | "WORKSPACE_TERMINATED"
  | "WORKSPACE_NON_RECOVERABLE"
  | "WORKSPACE_START_TIMEOUT"
  | "WORKSPACE_RESTART_FAILED";

export class GittermError extends Error {
  readonly code: GittermErrorCode;
  readonly cause?: unknown;

  constructor(code: GittermErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "GittermError";
    this.code = code;
    this.cause = options.cause;
  }
}

export class WorkspaceLifecycleError extends GittermError {
  declare readonly code: WorkspaceLifecycleErrorCode;

  constructor(
    code: WorkspaceLifecycleErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(code, message, options);
    this.name = "WorkspaceLifecycleError";
  }
}

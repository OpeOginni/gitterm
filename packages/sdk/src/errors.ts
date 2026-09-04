export type GittermErrorCode =
  | "NOT_LOGGED_IN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "SERVER_ERROR"
  | "NETWORK"
  | "ABORTED"
  | CredentialErrorCode
  | WorkspaceLifecycleErrorCode;

export type CredentialErrorCode =
  | "MODEL_CREDENTIAL_UNAVAILABLE"
  | "MODEL_CREDENTIAL_DUPLICATE_PROVIDER"
  | "MODEL_CREDENTIAL_INVALID"
  | "MODEL_CREDENTIAL_REQUIRED";

export type WorkspaceLifecycleErrorCode =
  | "WORKSPACE_NOT_RUNNING"
  | "WORKSPACE_TERMINATED"
  | "WORKSPACE_NON_RECOVERABLE"
  | "WORKSPACE_START_TIMEOUT"
  | "WORKSPACE_RESTART_FAILED";

export const WORKSPACE_LIFECYCLE_ERROR_CODES: readonly WorkspaceLifecycleErrorCode[] = [
  "WORKSPACE_NOT_RUNNING",
  "WORKSPACE_TERMINATED",
  "WORKSPACE_NON_RECOVERABLE",
  "WORKSPACE_START_TIMEOUT",
  "WORKSPACE_RESTART_FAILED",
];

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

export type GittermErrorCode =
  | "NOT_LOGGED_IN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "NETWORK";

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

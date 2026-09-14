export const AWS_STARTUP_TIMEOUT_MS = 180_000;
export const AWS_STARTUP_GRACE_SECONDS = 180;
export const AWS_ORPHAN_GRACE_MS = 10 * 60_000;

export class AwsWorkspaceStartupError extends Error {
  constructor(
    public readonly diagnostics: Record<string, unknown>,
    message = "AWS workspace did not become ready within the three-minute startup budget. Review its startup diagnostics and container logs.",
  ) {
    super(message);
    this.name = "AwsWorkspaceStartupError";
  }
}

/** An IAM principal (control-plane user or ECS execution role) lacks a permission this release needs. */
export class AwsPermissionError extends Error {
  readonly action: string | undefined;
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const action = /perform: ([a-z0-9-]+:[A-Za-z0-9]+)/.exec(message)?.[1];
    const principal = /User: arn:[^\s]*?:(?:user|assumed-role)\/([^/\s]+)/.exec(message)?.[1];
    super(
      `AWS denied ${action ?? "an AWS API call"}${principal ? ` for ${principal}` : ""}. ` +
        "Re-apply the generated deployment policy to the IAM user and re-run AWS setup so the stack grants new permissions.",
    );
    this.name = "AwsPermissionError";
    this.action = action;
    this.cause = cause;
  }
}

export function isAwsAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: string; message?: string };
  return (
    name === "AccessDeniedException" ||
    name === "AccessDenied" ||
    name === "UnauthorizedOperation" ||
    /is not authorized to perform/.test(message ?? "")
  );
}

export function isExpiredOrphan(createdAt: string | undefined, now = Date.now()): boolean {
  if (!createdAt) return false; // Legacy resources require explicit termination, not guesswork.
  const time = Date.parse(createdAt);
  return Number.isFinite(time) && now - time > AWS_ORPHAN_GRACE_MS;
}

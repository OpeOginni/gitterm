import type * as Runtime from "@gitterm/agent-runtime/sandbox/types";

/**
 * Public sandbox types. The provider implementations live in a private package that the
 * SDK bundles, so published declarations must not reference it; these mirror its shapes
 * and the assertions below keep the two in step.
 */
export type SandboxProviderKey =
  | "e2b"
  | "daytona"
  | "vercel"
  | "boat"
  | "exedev"
  | "railway"
  | "aws";

export type SandboxCapabilities = {
  /**
   * How an abandoned sandbox ends without the caller: `hard` deleted at the lifetime even
   * while busy; `idle` deleted after a period without API activity; `archive` stopped and
   * archived at the lifetime with storage kept until deleted; `none` never.
   */
  expiry: "hard" | "idle" | "archive" | "none";
  /** `private` needs the access header, `public` is open to anyone with the URL. */
  previews: "private" | "public" | "none";
  pause: "stateful" | "state-losing";
  maxLifetimeMs: number;
};

export type SandboxCommandResult = { exitCode: number; stdout: string; stderr: string };

export type SandboxPreviewAccess = { url: string; headers: Record<string, string> };

export type SandboxFailureCode = "auth" | "not_found" | "rate_limited" | "timeout" | "provider";

/** A provider or API failure, as opposed to a command that exited non-zero. */
export type SandboxProviderFailure = Error & {
  name: "SandboxProviderError";
  code: SandboxFailureCode;
};

export function isSandboxProviderError(error: unknown): error is SandboxProviderFailure {
  return error instanceof Error && error.name === "SandboxProviderError" && "code" in error;
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _keys: Same<SandboxProviderKey, Runtime.SandboxProviderKey> = true;
const _capabilities: Same<SandboxCapabilities, Runtime.SandboxCapabilities> = true;
const _result: Same<SandboxCommandResult, Runtime.SandboxCommandResult> = true;
const _preview: Same<SandboxPreviewAccess, Runtime.SandboxPreviewAccess> = true;
const _code: Same<SandboxFailureCode, Runtime.SandboxFailureCode> = true;
void [_keys, _capabilities, _result, _preview, _code];

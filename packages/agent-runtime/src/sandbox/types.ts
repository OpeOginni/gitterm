import { createHash } from "node:crypto";

/**
 * Plain command sandboxes: no coding agent, model credential, or Gitterm runtime runs
 * inside. Each provider implements the same small set of primitives; jobs, source sync,
 * and artifacts are built on top of them by the SDK. Shared by the direct SDK (caller's
 * own provider credentials) and the API server (the deployment's managed credentials).
 */

export const SANDBOX_PROVIDERS = [
  "e2b",
  "daytona",
  "vercel",
  "boat",
  "exedev",
  "railway",
  "aws",
  /** Gitterm's own sandboxes: gitterm.dev only. Sizes, not providers; see ./gitterm.ts. */
  "gitterm",
] as const;
export type SandboxProviderKey = (typeof SANDBOX_PROVIDERS)[number];

export type SandboxFailureCode = "auth" | "not_found" | "rate_limited" | "timeout" | "provider";

/** The provider or its API failed. Distinct from a command that ran and exited non-zero. */
export class SandboxProviderError extends Error {
  readonly code: SandboxFailureCode;
  /** A sandbox the failed call created but could not delete. The caller must delete it. */
  leftoverId?: string;
  constructor(code: SandboxFailureCode, message: string) {
    super(message);
    this.name = "SandboxProviderError";
    this.code = code;
  }
}

/**
 * Deletes a sandbox whose setup failed after the provider created it, then throws `error`.
 * If the delete fails too, the thrown error's `leftoverId` names the sandbox so the caller
 * can record it and retry.
 */
export async function discardFailedCreate(
  destroy: (id: string) => Promise<unknown>,
  id: string,
  error: unknown,
): Promise<never> {
  const deleted = await destroy(id).then(
    () => true,
    () => false,
  );
  if (deleted) throw error;
  const failed =
    error instanceof SandboxProviderError
      ? error
      : new SandboxProviderError(
          "provider",
          error instanceof Error ? error.message : String(error),
        );
  failed.leftoverId = id;
  throw failed;
}

export type SandboxProviderState = "pending" | "running" | "paused" | "terminated";

export type SandboxProviderInfo = {
  id: string;
  state: SandboxProviderState;
  labels: Record<string, string>;
  startedAt: string | null;
  /** When the provider itself deletes the sandbox, if it does. */
  expiresAt: string | null;
};

export type SandboxCommandResult = { exitCode: number; stdout: string; stderr: string };

export type SandboxPreviewAccess = {
  url: string;
  /** Required by private previews; sandbox-scoped bearer values. Never show them to a model. */
  headers: Record<string, string>;
};

export type SandboxCapabilities = {
  /**
   * How an abandoned sandbox ends without the caller:
   * `hard`: the provider deletes it at the requested lifetime, even while busy.
   * `idle`: the provider deletes it after a period without API activity.
   * `archive`: the provider stops and archives it at the lifetime; storage remains until deleted.
   * `none`: it runs until someone deletes it.
   */
  expiry: "hard" | "idle" | "archive" | "none";
  /**
   * `private`: previews need the returned access header. `public`: anyone with the URL.
   * `either`: private unless the sandbox is created with public previews.
   * `none`: the provider cannot expose sandbox ports.
   */
  previews: "private" | "public" | "either" | "none";
  /** Whether a paused sandbox keeps its files and processes. */
  pause: "stateful" | "state-losing";
  maxLifetimeMs: number;
  /**
   * Whether the sandbox can be saved as a snapshot new sandboxes start from, and what saving
   * does to it: `pauses` it briefly, or `stops` it for good (Vercel).
   */
  snapshots: "pauses" | "stops" | "none";
};

export type SandboxCreateInput = {
  labels: Record<string, string>;
  /** Requested lifetime. Meaning depends on `capabilities.expiry`. */
  timeoutMs: number;
  /** Managed sandboxes pause when idle; direct ones are deleted. */
  onTimeout?: "kill" | "pause";
  publicPreviews?: boolean;
  /** Provider image, template, snapshot, or size. Defaults to a plain image without agents. */
  template?: string;
  /**
   * Machine size as a machine profile's provider options, the same keys agent workspaces
   * use (`templateSuffix`, `resources`, `vcpus`, `size`, `cpu`/`memory`/`disk`). Managed only.
   */
  machine?: Record<string, unknown>;
  /**
   * Environment for every process in the sandbox, set at creation. E2B and Boat support it;
   * other providers ignore it, so pass per-command env there.
   */
  env?: Record<string, string>;
  /** Run after every resume, to restart services a pause stopped. Gitterm only. */
  resumeCommand?: string;
  /** Start from a snapshot saved with `snapshots.create` instead of the template. */
  snapshot?: string;
};

/**
 * Saves a sandbox's disk as a snapshot new sandboxes can start from. Snapshots outlive the
 * sandbox and are stored (and billed) in the provider account until deleted.
 */
export type SandboxSnapshots = {
  /** Returns the id to pass as `snapshot` when creating a sandbox. */
  create(id: string, name: string): Promise<string>;
  /** Deleting a snapshot that no longer exists succeeds. */
  delete(snapshotId: string): Promise<void>;
};

export interface SandboxTransport {
  readonly provider: SandboxProviderKey;
  /** Home directory of the command user; jobs and the project live below it. */
  readonly home: string;
  readonly capabilities: SandboxCapabilities;
  create(input: SandboxCreateInput): Promise<SandboxProviderInfo>;
  /** `terminated` for a sandbox that no longer exists or belongs to another account. */
  info(id: string): Promise<SandboxProviderInfo>;
  list(labels: Record<string, string>): Promise<SandboxProviderInfo[]>;
  destroy(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  keepAlive?(id: string, timeoutMs: number): Promise<void>;
  /** Runs a short command. A non-zero exit is a result, not an error. */
  run(
    id: string,
    command: string,
    options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<SandboxCommandResult>;
  writeFile(id: string, path: string, data: Uint8Array): Promise<void>;
  readFile(id: string, path: string): Promise<Uint8Array>;
  preview(id: string, port: number): Promise<SandboxPreviewAccess>;
  /** Present exactly where `capabilities.snapshots` is not `none`. */
  snapshots?: SandboxSnapshots;
}

/** Where commands run and what the provider guarantees. Shared by transports and clients. */
export type SandboxProviderProfile = { home: string; capabilities: SandboxCapabilities };

/**
 * Managed sandboxes whose previews the Gitterm proxy serves, adding the provider's access
 * header itself. Gitterm then decides who sees a preview, so any of them can be public.
 */
export const GITTERM_PREVIEW_PROVIDERS: readonly SandboxProviderKey[] = [
  "e2b",
  "daytona",
  "boat",
  "exedev",
  "gitterm",
];

const DAY = 24 * 60 * 60_000;
export const SANDBOX_PROVIDER_PROFILES: Record<SandboxProviderKey, SandboxProviderProfile> = {
  e2b: {
    home: "/home/user",
    capabilities: {
      expiry: "hard",
      previews: "either",
      pause: "stateful",
      maxLifetimeMs: DAY,
      snapshots: "pauses",
    },
  },
  daytona: {
    home: "/home/daytona",
    capabilities: {
      expiry: "hard",
      previews: "either",
      pause: "stateful",
      maxLifetimeMs: DAY,
      snapshots: "pauses",
    },
  },
  vercel: {
    home: "/home/vercel-sandbox",
    capabilities: {
      expiry: "hard",
      previews: "public",
      pause: "stateful",
      maxLifetimeMs: 5 * 60 * 60_000,
      snapshots: "stops",
    },
  },
  boat: {
    home: "/home/user",
    capabilities: {
      expiry: "archive",
      previews: "private",
      pause: "stateful",
      maxLifetimeMs: DAY,
      snapshots: "pauses",
    },
  },
  exedev: {
    home: "/home/exedev",
    capabilities: {
      expiry: "none",
      previews: "private",
      pause: "stateful",
      maxLifetimeMs: DAY,
      snapshots: "none",
    },
  },
  railway: {
    home: "/root",
    capabilities: {
      expiry: "none",
      previews: "private",
      pause: "state-losing",
      maxLifetimeMs: DAY,
      snapshots: "none",
    },
  },
  aws: {
    home: "/root",
    capabilities: {
      expiry: "none",
      previews: "private",
      pause: "state-losing",
      maxLifetimeMs: DAY,
      snapshots: "none",
    },
  },
  // The Gitterm server enforces lifetimes and serves previews.
  gitterm: {
    home: "/home/user",
    capabilities: {
      expiry: "hard",
      previews: "private",
      pause: "stateful",
      maxLifetimeMs: DAY,
      snapshots: "pauses",
    },
  },
};

/**
 * Providers that cannot attach labels encode the owning account in the sandbox name as a
 * short hash, reported back as the `gitterm_account_hash` label.
 */
export function accountHash(account: string): string {
  return createHash("sha256").update(account).digest("hex").slice(0, 10);
}

/**
 * Deletes a sandbox and waits until the provider reports it gone. Some providers accept a
 * deletion and finish it later; a sandbox is only deleted once `info` says so. If it is not
 * confirmed in time this throws, and the caller's cleanup queue retries later.
 */
export async function destroyAndConfirm(
  transport: SandboxTransport,
  id: string,
  timeoutMs = 30_000,
) {
  await transport.destroy(id);
  const deadline = Date.now() + timeoutMs;
  while ((await transport.info(id)).state !== "terminated") {
    if (Date.now() > deadline)
      throw new SandboxProviderError(
        "timeout",
        `${transport.provider} has not confirmed the deletion yet.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export function terminated(id: string): SandboxProviderInfo {
  return { id, state: "terminated", labels: {}, startedAt: null, expiresAt: null };
}

export function validatePort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Port must be between 1 and 65535");
}

export function validateLifetime(timeoutMs: number, maxLifetimeMs: number) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 60_000)
    throw new Error("Sandbox lifetime must be at least one minute");
  if (timeoutMs > maxLifetimeMs)
    throw new Error(
      `Sandbox lifetime cannot exceed ${Math.floor(maxLifetimeMs / 60_000)} minutes on this provider`,
    );
}

/** Maps provider SDK/API failures to a classification without echoing request details. */
export function classifyFailure(
  provider: string,
  error: unknown,
  action: string,
  hints: { auth?: (error: unknown) => boolean; notFound?: (error: unknown) => boolean } = {},
): SandboxProviderError {
  if (error instanceof SandboxProviderError) return error;
  const status =
    (error as { status?: number; statusCode?: number; response?: { status?: number } })?.status ??
    (error as { statusCode?: number })?.statusCode ??
    (error as { response?: { status?: number } })?.response?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (
    hints.auth?.(error) ||
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|not authori[sz]ed|invalid (api )?(key|token)|forbidden/i.test(message)
  )
    return new SandboxProviderError(
      "auth",
      `${provider} rejected the credential while trying to ${action}.`,
    );
  if (
    hints.notFound?.(error) ||
    status === 404 ||
    /not found|does not exist|no such/i.test(message)
  )
    return new SandboxProviderError(
      "not_found",
      `${provider} could not find the sandbox while trying to ${action}. It may have expired or belong to another account.`,
    );
  if (status === 429 || /rate limit|too many requests/i.test(message))
    return new SandboxProviderError(
      "rate_limited",
      `${provider} rate-limited the request to ${action}.`,
    );
  if (/timed? ?out|timeout/i.test(message))
    return new SandboxProviderError("timeout", `${provider} timed out while trying to ${action}.`);
  return new SandboxProviderError("provider", `${provider} failed to ${action}.`);
}

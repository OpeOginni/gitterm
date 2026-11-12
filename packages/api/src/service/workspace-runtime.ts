import type { Workspace } from "@gitterm/db/schema/workspace";
import { buildProjectPathHint } from "../providers/ssh-access";
import { getWorkspaceUrl } from "../utils/routing";

export type PublicWorkspaceStatus = "pending" | "running" | "paused" | "terminated";

export type WorkspaceRuntimeAccess = {
  workspaceId: string;
  status: PublicWorkspaceStatus;
  url: string | null;
  headers?: Record<string, string>;
  password?: string;
  directory: string;
  repo: string | null;
  branch: string | null;
  baseCommit: string | null;
  checkoutRef: string | null;
  persistent: boolean;
  recoverable: boolean;
  providerKey: string | null;
};

export type WorkspaceRuntimeSource = Pick<
  Workspace,
  | "id"
  | "status"
  | "subdomain"
  | "repositoryUrl"
  | "repositoryBranch"
  | "repositoryBaseCommit"
  | "repositoryCheckoutRef"
  | "persistent"
  | "serverOnly"
  | "serverPassword"
> & {
  providerKey?: string | null;
};

/** Statuses that do not require a provider-specific resume operation. */
export const RECOVERABLE_WORKSPACE_STATUSES = new Set<PublicWorkspaceStatus>([
  "pending",
  "running",
]);

export function isRecoverableWorkspaceStatus(status: string, providerCanResume = false): boolean {
  return (
    RECOVERABLE_WORKSPACE_STATUSES.has(status as PublicWorkspaceStatus) ||
    (status === "paused" && providerCanResume)
  );
}

export function isResumableWorkspaceStatus(status: string): boolean {
  return status === "paused";
}

/**
 * Whether reconciling with the provider may move a workspace out of `pending`. A create or
 * restart holds `pending` while it works and settles the row itself; reconciling meanwhile
 * would undo that, publishing it `running` before its agent is, or `paused` before a resume
 * lands so a second restart gets in. Its operation lease says whether it is still working.
 */
export function mayReconcilePending(
  row: { status: string; upstreamUrl: string | null; operationLeaseUntil: Date | null },
  liveStatus: string,
  now = Date.now(),
): boolean {
  if (row.status !== "pending" || liveStatus === "terminated") return true;
  if (row.operationLeaseUntil && row.operationLeaseUntil.getTime() > now) return false;
  // A create that never finished (it sets the upstream when it settles) has nothing to publish.
  if (!row.upstreamUrl) return false;
  // A restart whose owner is gone, or one the provider settles: take the provider's word.
  return true;
}

/**
 * Resolve the project directory inside a sandbox for a given provider.
 * E2B and Gitterm use `/home/user/workspace`, Vercel uses `/vercel/sandbox`, Boat uses
 * `/home/user`, exe.dev uses `/home/exedev`, and most other providers use
 * `/workspace`.
 */
export function resolveProjectDirectory(
  repositoryUrl: string | null | undefined,
  providerKey?: string | null,
): string {
  const key = (providerKey ?? "").toLowerCase();
  // Without a repository, these providers make an empty `workspace` directory, where a
  // repository's clone would go. Daytona and Cloudflare use their root directory.
  const hint = buildProjectPathHint(
    repositoryUrl ||
      (["e2b", "gitterm", "vercel", "boat", "exedev", "railway", "aws"].includes(key)
        ? "workspace"
        : null),
  );
  if (["e2b", "gitterm"].includes((providerKey ?? "").toLowerCase())) {
    return hint.replace(/^\/workspace/, "/home/user/workspace");
  }
  if ((providerKey ?? "").toLowerCase() === "vercel") {
    return hint.replace(/^\/workspace/, "/vercel/sandbox");
  }
  if ((providerKey ?? "").toLowerCase() === "boat") {
    return hint.replace(/^\/workspace/, "/home/user");
  }
  if ((providerKey ?? "").toLowerCase() === "exedev") {
    return hint.replace(/^\/workspace/, "/home/exedev");
  }
  return hint;
}

/** Control-plane secrets that must never leave the server. */
const SERVER_ONLY_UPSTREAM_HEADERS = new Set(["x-gitterm-cf-internal-key"]);

/**
 * Strip control-plane credentials from upstream headers before returning them
 * to workspace owners / SDK clients. Server-side proxy still uses the full
 * encrypted route-access headers.
 */
export function toClientUpstreamHeaders(
  headers?: Record<string, string> | null,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const filtered = Object.fromEntries(
    Object.entries(headers).filter(([key]) => !SERVER_ONLY_UPSTREAM_HEADERS.has(key.toLowerCase())),
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export function buildWorkspaceRuntimeAccess(options: {
  workspace: WorkspaceRuntimeSource;
  headers?: Record<string, string> | null;
  password?: string | null;
  providerKey?: string | null;
  providerCanResume?: boolean;
}): WorkspaceRuntimeAccess {
  const { workspace } = options;
  const providerKey = options.providerKey ?? workspace.providerKey ?? null;
  const status = workspace.status as PublicWorkspaceStatus;
  const terminated = status === "terminated";
  const url = !terminated && workspace.subdomain ? getWorkspaceUrl(workspace.subdomain) : null;
  const headers = terminated ? undefined : toClientUpstreamHeaders(options.headers);
  const password = terminated ? undefined : (options.password ?? undefined);

  return {
    workspaceId: workspace.id,
    status,
    url,
    headers,
    password: password || undefined,
    directory: resolveProjectDirectory(workspace.repositoryUrl, providerKey),
    repo: workspace.repositoryUrl,
    branch: workspace.repositoryBranch,
    baseCommit: workspace.repositoryBaseCommit,
    checkoutRef: workspace.repositoryCheckoutRef,
    persistent: workspace.persistent,
    recoverable: isRecoverableWorkspaceStatus(status, options.providerCanResume),
    providerKey,
  };
}

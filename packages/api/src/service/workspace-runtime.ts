import type { Workspace } from "@gitterm/db/schema/workspace";
import { SANDBOX_PROVIDER_PROFILES } from "@gitterm/agent-runtime/sandbox/types";
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
 * The project directory inside a workspace: `<root>/<repo>`, with the provider profile's
 * `workspaceRoot`, where the workspace provider clones it. Others use `/workspace`.
 */
export function resolveProjectDirectory(
  repositoryUrl: string | null | undefined,
  providerKey?: string | null,
): string {
  const profiles: Partial<Record<string, { workspaceRoot: string }>> = SANDBOX_PROVIDER_PROFILES;
  const root = profiles[(providerKey ?? "").toLowerCase()]?.workspaceRoot;
  const hint = buildProjectPathHint(repositoryUrl || (root ? "workspace" : null));
  return root ? hint.replace(/^\/workspace/, root) : hint;
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
  const headers =
    terminated || !options.headers || !Object.keys(options.headers).length
      ? undefined
      : options.headers;
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

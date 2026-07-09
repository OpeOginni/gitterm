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

/** Statuses from which a workspace can still be resumed. */
export const RECOVERABLE_WORKSPACE_STATUSES = new Set<PublicWorkspaceStatus>([
  "pending",
  "running",
  "paused",
]);

export function isRecoverableWorkspaceStatus(status: string): boolean {
  return RECOVERABLE_WORKSPACE_STATUSES.has(status as PublicWorkspaceStatus);
}

export function isResumableWorkspaceStatus(status: string): boolean {
  return status === "paused";
}

/**
 * Resolve the project directory inside a sandbox for a given provider.
 * E2B uses `/home/user/workspace`; most other providers use `/workspace`.
 */
export function resolveProjectDirectory(
  repositoryUrl: string | null | undefined,
  providerKey?: string | null,
): string {
  const hint = buildProjectPathHint(repositoryUrl);
  if ((providerKey ?? "").toLowerCase() === "e2b") {
    return hint.replace(/^\/workspace/, "/home/user/workspace");
  }
  return hint;
}

export function buildWorkspaceRuntimeAccess(options: {
  workspace: WorkspaceRuntimeSource;
  headers?: Record<string, string> | null;
  password?: string | null;
  providerKey?: string | null;
}): WorkspaceRuntimeAccess {
  const { workspace } = options;
  const providerKey = options.providerKey ?? workspace.providerKey ?? null;
  const status = workspace.status as PublicWorkspaceStatus;
  const url = workspace.subdomain ? getWorkspaceUrl(workspace.subdomain) : null;
  const headers =
    options.headers && Object.keys(options.headers).length > 0 ? options.headers : undefined;
  const password = options.password ?? undefined;

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
    recoverable: isRecoverableWorkspaceStatus(status),
    providerKey,
  };
}

import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@gitterm/api/routers/index";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type AuthStatus = {
  loggedIn: true;
  userId: string;
  email: string;
  name: string;
  plan: string;
  authMethod: "session" | "apiToken";
};

export type WorkspaceStatus = "pending" | "running" | "paused" | "terminated";
export type WorkspaceHostingType = "cloud" | "local";

export type Workspace = {
  id: string;
  name: string | null;
  status: WorkspaceStatus;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  baseCommit: string | null;
  checkoutRef: string | null;
  domain: string;
  subdomain: string | null;
  persistent: boolean;
  hostingType: WorkspaceHostingType;
  serverOnly: boolean;
  workspaceProfile: string;
  cloudProviderId: string;
  agentType: { id: string; name: string; description: string | null } | null;
  image: { id: string; name: string; imageId: string } | null;
  startedAt: string | null;
  stoppedAt: string | null;
  terminatedAt: string | null;
  lastActiveAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceRuntimeAccess = {
  workspaceId: string;
  status: WorkspaceStatus;
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

export type WorkspaceCreateResult = {
  workspace: Workspace;
  runtime: WorkspaceRuntimeAccess;
};

export type WorkspaceListOptions = NonNullable<RouterInputs["workspace"]["listWorkspaces"]>;
export type WorkspaceListResult = {
  workspaces: Workspace[];
  pagination: RouterOutputs["workspace"]["listWorkspaces"]["pagination"];
};
export type WorkspaceCreateInput = RouterInputs["workspace"]["createWorkspace"];
export type WorkspaceRestartResult = Pick<RouterOutputs["workspace"]["restartWorkspace"], "status">;
export type WorkspaceStopResult = Pick<
  RouterOutputs["workspace"]["pauseWorkspace"],
  "durationMinutes"
>;
/** @deprecated use WorkspaceStopResult — same shape for pauseWorkspace */
export type WorkspacePauseResult = WorkspaceStopResult;
export type WorkspaceTerminateResult = {
  workspace: Workspace | null;
  cleanupInBackground: boolean;
};
export type WorkspaceEnsureRunningResult = {
  workspace: Workspace;
  runtime: WorkspaceRuntimeAccess;
};

export type AgentType = RouterOutputs["workspace"]["listAgentTypes"]["agentTypes"][number];
export type CloudProvider =
  RouterOutputs["workspace"]["listCloudProviders"]["cloudProviders"][number];

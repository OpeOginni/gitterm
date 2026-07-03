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

export type WorkspaceStatus = "pending" | "running" | "stopped" | "terminated";
export type WorkspaceHostingType = "cloud" | "local";

export type Workspace = {
  id: string;
  name: string | null;
  status: WorkspaceStatus;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
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

export type WorkspaceListOptions = NonNullable<RouterInputs["workspace"]["listWorkspaces"]>;
export type WorkspaceListResult = {
  workspaces: Workspace[];
  pagination: RouterOutputs["workspace"]["listWorkspaces"]["pagination"];
};
export type WorkspaceCreateInput = RouterInputs["workspace"]["createWorkspace"];
export type WorkspaceRestartResult = Pick<RouterOutputs["workspace"]["restartWorkspace"], "status">;
export type WorkspaceStopResult = Pick<
  RouterOutputs["workspace"]["stopWorkspace"],
  "durationMinutes"
>;
export type WorkspaceTerminateResult = {
  workspace: Workspace | null;
  cleanupInBackground: boolean;
};

export type AgentType = RouterOutputs["workspace"]["listAgentTypes"]["agentTypes"][number];
export type CloudProvider =
  RouterOutputs["workspace"]["listCloudProviders"]["cloudProviders"][number];

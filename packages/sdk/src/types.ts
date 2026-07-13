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
  pausedAt: string | null;
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

export type WorkspaceListOptions = {
  limit?: number;
  offset?: number;
  status?: "all" | "active" | "terminated";
};
export type WorkspaceListResult = {
  workspaces: Workspace[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
};
export type WorkspaceCreateInput = {
  idempotencyKey?: string;
  name?: string;
  repo?: string;
  branch?: string;
  baseCommit?: string;
  checkoutRef?: string;
  subdomain?: string;
  /** Unique enabled agent name. */
  agent: string;
  /** Unique enabled provider name. Optional when a preferred default exists. */
  provider?: string;
  regionId?: string;
  gitIntegrationId?: string;
  persistent: boolean;
  workspaceProfile?: "standard" | "ssh-enabled";
  modelCredentialIds?: string[];
};
export type WorkspaceRestartResult = { status: WorkspaceStatus };
export type WorkspacePauseResult = { durationMinutes: number };
export type WorkspaceTerminateResult = {
  workspace: Workspace | null;
  cleanupInBackground: boolean;
};
export type WorkspaceEnsureRunningResult = {
  workspace: Workspace;
  runtime: WorkspaceRuntimeAccess;
};

export type AgentType = {
  id: string;
  name: string;
  description: string | null;
  serverOnly: boolean;
  isEnabled: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type CloudProvider = {
  id: string;
  name: string;
  providerKey: string;
  regions?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type SandboxDefaults = {
  agent: string;
  provider: string;
  agentTypeId: string;
  cloudProviderId: string;
  regionId?: string;
};

export type SandboxDefaultsInput = {
  agent: string;
  provider?: string;
};

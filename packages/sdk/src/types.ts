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

export type ProviderKey =
  | "railway"
  | "aws"
  | "e2b"
  | "daytona"
  | "cloudflare"
  | "vercel"
  | "ascii"
  | "exedev";

type ProviderSelectionBase = {
  /** Select a specific provider installation. Usually omitted. */
  providerId?: string;
  /** An admin-defined profile or flexible resources within the provider's allowed limits. */
  machine?: { type: "profile"; key: string };
};

type FlexibleMachine<T> = { type: "profile"; key: string } | { type: "custom"; resources: T };

type AwsResources = {
  cpu?: number;
  memory?: number;
  ephemeralStorageGiB?: number;
  architecture?: "X86_64" | "ARM64";
};
type DaytonaResources = {
  resources?: { cpu?: number; memory?: number; disk?: number };
  editorResources?: { cpu?: number; memory?: number; disk?: number };
};
type VercelResources = { vcpus?: number };
type ExeDevResources = { cpu?: number; memory?: string; disk?: string };

export type WorkspaceProviderSelection =
  | { type: "railway"; providerId?: string; region?: string }
  | ({ type: "aws"; region?: string } & Omit<ProviderSelectionBase, "machine"> & {
        machine?: FlexibleMachine<AwsResources>;
      })
  | ({ type: "daytona" } & Omit<ProviderSelectionBase, "machine"> & {
        machine?: FlexibleMachine<DaytonaResources>;
      })
  | ({ type: "vercel" } & Omit<ProviderSelectionBase, "machine"> & {
        machine?: FlexibleMachine<VercelResources>;
      })
  | ({ type: "exedev" } & Omit<ProviderSelectionBase, "machine"> & {
        machine?: FlexibleMachine<ExeDevResources>;
      })
  | ({ type: "e2b" | "ascii" } & ProviderSelectionBase)
  | { type: "cloudflare"; providerId?: string };

export type BuiltInAgentKey = "opencode-ttyd" | "opencode" | "t3code";
export type AgentKey = BuiltInAgentKey | (string & {});

export type WorkspaceCreateInput = {
  idempotencyKey?: string;
  name?: string;
  repo: string;
  branch?: string;
  baseCommit?: string;
  checkoutRef?: string;
  subdomain?: string;
  /** Stable agent key. Defaults to `opencode`. */
  agent?: AgentKey;
  /** Provider intent. Defaults to the user's or deployment's preferred provider. */
  provider?: WorkspaceProviderSelection;
  gitIntegrationId?: string;
  /** Defaults from the selected provider. */
  persistent?: boolean;
  workspaceProfile?: "standard" | "ssh-enabled";
  modelCredentialIds?: string[];
  /**
   * Ordered commands launched in the repository after the agent server starts.
   * They do not block workspace readiness; inspect ~/.gitterm/setup for status
   * and logs through workspaces.setupStatus()/waitForSetup().
   */
  setupCommands?: string[];
  /** OpenCode capabilities materialized only in this workspace. */
  opencode?: {
    skills?: Array<{ name: string; content: string }>;
    /** NPM package specs or plugin paths accepted by OpenCode. Pin versions for repeatable runs. */
    plugins?: string[];
  };
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

export type AgentRunStatus =
  | "pending"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRun = {
  id: string;
  workspaceId: string;
  title: string;
  status: AgentRunStatus;
  error: string | null;
  finalText: string | null;
};

export type AgentRunCreateInput = {
  workspaceId: string;
  /** Stable key used to return the same run when a request is retried. */
  idempotencyKey: string;
  prompt: string;
  title?: string;
  agent?: string;
  /** OpenCode model in provider/model format. */
  model?: string;
  /** Wait for workspace setup commands before submitting the prompt. */
  waitForSetup?: boolean;
  setupTimeoutMs?: number;
};

export type AgentRunMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  completedAt: string | null;
  text: string;
  error: string | null;
};

export type WorkspaceSetupStatus = {
  status: "not_requested" | "waiting" | "running" | "succeeded" | "failed";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string | null;
};

export type AgentType = {
  id: string;
  key: string;
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
  providerKey: ProviderKey | string;
  regions?: Array<{
    id: string;
    name: string;
    location: string;
    externalRegionIdentifier: string;
  }>;
};

export type WorkspaceCatalog = {
  agents: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    serverOnly: boolean;
  }>;
  providers: Array<{
    id: string;
    type: ProviderKey;
    name: string;
    isDefault: boolean;
    persistence: "required" | "optional" | "unsupported";
    regionSelection: "none" | "user" | "admin";
    regions: Array<{ id: string; key: string; name: string; location: string }>;
    machines: Array<{
      id: string;
      key: string;
      name: string;
      description: string | null;
      isDefault: boolean;
    }>;
    agentKeys: string[];
    ssh: boolean;
  }>;
};

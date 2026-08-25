export type DirectWorkspaceLifecycle = "ephemeral" | "persistent";
export type DirectWorkspaceStatus =
  | "pending"
  | "running"
  | "paused"
  | "failed"
  | "terminated"
  | "unknown";

export type DirectProviderCapabilities = {
  persistence: "supported" | "unsupported";
  recommendedLifecycle: DirectWorkspaceLifecycle;
  supportsPause: boolean;
  /** Whether manually pausing an ephemeral workspace preserves its filesystem/session. */
  ephemeralPause: "stateful" | "state-losing" | "unsupported";
  supportsKeepAlive: boolean;
};

export type DirectModelCredential = {
  providerName: string;
  apiKey: string;
};

export type DirectWorkspaceCreateInput = {
  id?: string;
  repo?: string;
  branch?: string;
  baseCommit?: string;
  checkoutRef?: string;
  repositoryCredentials?: { username?: string; token: string };
  lifecycle?: DirectWorkspaceLifecycle;
  environmentVariables?: Record<string, string>;
  modelCredentials?: DirectModelCredential[];
  setupCommands?: string[];
  opencode?: {
    config?: Record<string, unknown>;
    plugins?: string[];
    skills?: Array<{ name: string; content: string }>;
  };
};

export type DirectWorkspaceRuntime = {
  url: string;
  directory: string;
  headers?: Record<string, string>;
  password?: string;
};

export type DirectWorkspace = {
  id: string;
  provider: string;
  externalId: string;
  status: DirectWorkspaceStatus;
  lifecycle: DirectWorkspaceLifecycle;
  runtime: DirectWorkspaceRuntime;
  createdAt: string;
};

export type DirectProviderWorkspaceInput = DirectWorkspaceCreateInput & {
  id: string;
  lifecycle: DirectWorkspaceLifecycle;
  password: string;
  provisioning: DirectProvisioningPlan;
};

export type DirectAgentFile = { path: string; contentBase64: string };

export type DirectProvisioningPlan = {
  workspaceId: string;
  lifecycle: DirectWorkspaceLifecycle;
  repository?: {
    url: string;
    name: string;
    branch?: string;
    checkoutRef?: string;
    baseCommit?: string;
    authUsername?: string;
    authToken?: string;
  };
  agent: {
    files: DirectAgentFile[];
    environmentVariables: Record<string, string>;
    command: string;
    port: number;
  };
  setupCommands: string[];
};

export interface DirectProviderAdapter {
  readonly name: string;
  readonly capabilities: DirectProviderCapabilities;
  create(input: DirectProviderWorkspaceInput): Promise<{
    externalId: string;
    runtime: DirectWorkspaceRuntime;
  }>;
  status(workspace: DirectWorkspace): Promise<DirectWorkspaceStatus>;
  pause?(workspace: DirectWorkspace): Promise<void>;
  resume?(workspace: DirectWorkspace): Promise<Partial<DirectWorkspaceRuntime> | void>;
  terminate(workspace: DirectWorkspace): Promise<void>;
  keepAlive?(workspace: DirectWorkspace, timeoutMs: number): Promise<void>;
}

export type E2BDirectProviderConfig = {
  type: "e2b";
  apiKey: string;
  /** An E2B template containing Node.js, git, and the `opencode` binary. */
  templateId: string;
  timeoutMs?: number;
};

export type DaytonaDirectProviderConfig = {
  type: "daytona";
  apiKey: string;
  target: "us" | "eu";
  image?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
};

export type VercelDirectProviderConfig = {
  type: "vercel";
  apiToken: string;
  teamId: string;
  projectId: string;
  image?: string;
  runtime?: "node26" | "node24" | "node22" | "python3.13";
  runtimeSetupCommands?: string[];
  vcpus?: number;
  timeoutMs?: number;
};

export type AsciiDirectProviderConfig = {
  type: "ascii";
  apiKey: string;
  size?: "small" | "default" | "large";
  runtimeSetupCommands?: string[];
  timeoutMs?: number | null;
};

export type ExeDevDirectProviderConfig = {
  type: "exedev";
  apiToken: string;
  image?: string;
  cpu?: number;
  memory?: string;
  disk?: string;
  runtimeSetupCommands?: string[];
};

export type RailwayDirectProviderConfig = {
  type: "railway";
  apiToken: string;
  apiUrl?: string;
  projectId: string;
  environmentId: string;
  region?: string;
  image?: string;
  runtimePort?: number;
};

export type DirectProviderConfig =
  | E2BDirectProviderConfig
  | DaytonaDirectProviderConfig
  | VercelDirectProviderConfig
  | AsciiDirectProviderConfig
  | ExeDevDirectProviderConfig
  | RailwayDirectProviderConfig;

export type DirectRunCreateInput = {
  workspace: DirectWorkspace;
  prompt: string;
  title?: string;
  agent?: string;
  model?: string;
  /** Reuse this native OpenCode session for conversational context. */
  sessionId?: string;
};

export type DirectRun = {
  id: string;
  workspaceId: string;
  sessionId: string;
  messageId: string;
  title: string;
  status: "running" | "retrying" | "completed" | "failed" | "cancelled";
  error: string | null;
  finalText: string | null;
  submittedAt: string;
};

export type DirectRunMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  error: string | null;
};

export type DirectRunWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

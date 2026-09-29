import type { AgentRun, AgentRunMessage, RunWaitOptions } from "../types.js";

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

export type DirectApiModelCredential = {
  providerName: string;
  /** Account label shown in OpenCode. Defaults to "Gitterm". */
  label?: string;
  source: "apiKey";
  apiKey: string;
  metadata?: Record<string, string>;
};

export type DirectOAuthModelCredential = {
  providerName: string;
  /** Account label shown in OpenCode. Defaults to "Gitterm". */
  label?: string;
  source: "oauth";
  refreshToken: string;
  /** May be omitted when OpenCode should refresh immediately. */
  accessToken?: string;
  /** Unix epoch time in milliseconds. Defaults to expired when omitted. */
  expiresAt?: number;
  accountId?: string;
  enterpriseUrl?: string;
};

export type DirectModelCredential = DirectApiModelCredential | DirectOAuthModelCredential;

type DirectAuthPromptBase = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  /** Show the field only when every condition holds for an earlier answer. */
  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>;
};

type DirectAuthPromptOption = { value: string; label: string; description?: string };

type DirectAuthPromptNumber = number | "Infinity" | "-Infinity" | "NaN";

/** A field an OAuth or key method asks for (OpenCode 2 `FormField`); answer it with `connectOAuth({ inputs })`. */
export type DirectAuthPrompt =
  | (DirectAuthPromptBase & {
      type: "string";
      format?: "email" | "uri" | "date" | "date-time";
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      placeholder?: string;
      default?: string;
      options?: DirectAuthPromptOption[];
      custom?: boolean;
    })
  | (DirectAuthPromptBase & {
      type: "number" | "integer";
      minimum?: DirectAuthPromptNumber;
      maximum?: DirectAuthPromptNumber;
      default?: DirectAuthPromptNumber;
    })
  | (DirectAuthPromptBase & { type: "boolean"; default?: boolean })
  | (DirectAuthPromptBase & {
      type: "multiselect";
      options: DirectAuthPromptOption[];
      minItems?: number;
      maxItems?: number;
      custom?: boolean;
      default?: string[];
    })
  | { key: string; type: "external"; url: string; title?: string; description?: string };

/** OpenCode 2 `IntegrationMethod`. */
export type DirectAuthMethod =
  | { type: "oauth"; id: string; label: string; form?: DirectAuthPrompt[] }
  | { type: "command"; id: string; label: string; command: string[] }
  | { type: "key"; label?: string; form?: DirectAuthPrompt[] }
  | { type: "env"; names: string[] };

/** OpenCode 2 `IntegrationInfo`. */
export type DirectAuthIntegration = {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
  methods: DirectAuthMethod[];
  connections: Array<
    | { type: "credential"; id: string; label: string; method: "key" | "oauth" }
    | { type: "env"; name: string }
  >;
};

export type DirectAuthAttempt = {
  id: string;
  workspaceId: string;
  integrationId: string;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  createdAt: number;
  expiresAt: number;
};

export type DirectAuthAttemptStatus =
  | { status: "pending"; createdAt: number; expiresAt: number }
  | { status: "complete"; createdAt: number; expiresAt: number }
  | { status: "failed"; message: string; createdAt: number; expiresAt: number }
  | { status: "expired"; createdAt: number; expiresAt: number };

export type DirectAuthWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type DirectSecretFile = {
  /** Absolute path or a path below the workspace user's home (`~/...`). */
  path: string;
  content: string;
  /** Unix permission bits. Defaults to owner read/write (0600). */
  mode?: number;
};

export type DirectWorkspaceSetup = {
  beforeAgent?: string[];
  afterAgent?: string[];
};

export type DirectWorkspaceCreateInput = {
  id?: string;
  repo?: string;
  branch?: string;
  baseCommit?: string;
  checkoutRef?: string;
  /** Git credentials; also configure runtime Git/gh authentication for github.com. Not auto-renewed. */
  repositoryCredentials?: { username?: string; token: string };
  lifecycle?: DirectWorkspaceLifecycle;
  environmentVariables?: Record<string, string>;
  models?: {
    default?: string;
    inherit?: "none";
    providers?: Record<
      string,
      | Omit<DirectApiModelCredential, "providerName">
      | Omit<DirectOAuthModelCredential, "providerName">
    >;
  };
  setup?: DirectWorkspaceSetup;
  secretFiles?: DirectSecretFile[];
  /** Provider-specific attachment settings. */
  exedev?: { existingVmName: string };
  /** Trusted integration context appended to the generated global AGENTS.md. */
  additionalAgentInstructions?: string;
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
  setup: "not_requested" | "before_agent_complete" | "after_agent";
  createdAt: string;
};

export type DirectWorkspaceSetupStatus = {
  status: "not_requested" | "waiting" | "running" | "succeeded" | "failed";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string | null;
};

export type DirectWorkspaceSetupWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type DirectProviderWorkspaceInput = DirectWorkspaceCreateInput & {
  id: string;
  lifecycle: DirectWorkspaceLifecycle;
  password: string;
  provisioning: DirectProvisioningPlan;
};

export type DirectAgentFile = { path: string; contentBase64: string; mode?: number };

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
  setup: {
    beforeAgent: string[];
    afterAgent: string[];
  };
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
  /** Optional. Defaults to standard. */
  size?: "standard" | "large";
  /** Optional. Overrides size with a specific E2B template. */
  templateId?: string;
  timeoutMs?: number;
};

export type DaytonaDirectProviderConfig = {
  type: "daytona";
  apiKey: string;
  target: "us" | "eu";
  /** Optional. Defaults to the public Gitterm OpenCode server image. Floating tags are pinned to a digest. */
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
  /** Optional VCR image. When omitted, the configured Node runtime is used. */
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
  /**
   * Token `cmds` must include `new`, `ls`, `ssh`, `share`, `ssh-key`, `pause`, `resume`, and `rm`.
   * Default tokens cannot provision or clean up a Gitterm workspace.
   */
  apiToken: string;
  /** Optional. Defaults to the public Gitterm OpenCode server image. */
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
  /** Optional. Defaults to the public Gitterm OpenCode server image. */
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
  context?: { type: "isolated" } | { type: "continue"; run: DirectRun };
  waitForSetup?: boolean;
  setupTimeoutMs?: number;
  signal?: AbortSignal;
};

/** Contains runtime credentials. Encrypt when persisting; do not send to an untrusted UI. */
export type DirectRun = AgentRun & {
  workspace: DirectWorkspace;
  sessionId: string;
  messageId: string;
};

export type DirectRunMessage = AgentRunMessage;

export type DirectRunWaitOptions = RunWaitOptions;

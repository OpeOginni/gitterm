export type AuthStatus = {
  loggedIn: true;
  userId: string;
  email: string;
  name: string;
  plan: string;
  authMethod: "session" | "apiToken";
};

/**
 * `pending` — compute is being provisioned or resumed; `runtime.url` is null.
 * `running` — the provider reports the sandbox/container up. The agent may
 * still be booting; `runs.create()` waits for it to answer.
 * `paused` — stopped but resumable with `workspaces.ensureRunning()`.
 * `terminated` — gone for good.
 */
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
  /** Caller-owned tags supplied at create time. */
  metadata: Record<string, string>;
  /** When set, the workspace is terminated at this time regardless of activity. */
  autoTerminateAt: string | null;
  /** The caller-supplied image or E2B template this workspace runs, if any. */
  customImage: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  terminatedAt: string | null;
  lastActiveAt: string | null;
  updatedAt: string | null;
};

/** A workspace id, or any object carrying one (e.g. a `Workspace`). */
export type WorkspaceRef = string | { id: string };

/** A run id pair, or any object carrying one (e.g. an `AgentRun`). */
export type RunRef = { workspaceId: string; id: string } | { workspaceId: string; runId: string };

export type WaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Abort the wait early; the promise rejects with code `ABORTED`. */
  signal?: AbortSignal;
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
  /** Only workspaces whose metadata contains every given key/value. */
  metadata?: Record<string, string>;
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
/** E2B fixes CPU/RAM per template, so resources select a template build. */
type E2bResources = { templateId?: string; sshTemplateId?: string };

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
  | ({ type: "e2b" } & Omit<ProviderSelectionBase, "machine"> & {
        machine?: FlexibleMachine<E2bResources>;
      })
  | ({ type: "ascii" } & ProviderSelectionBase)
  | { type: "cloudflare"; providerId?: string };

export type BuiltInAgentKey = "opencode-ttyd" | "opencode" | "t3code";
export type AgentKey = BuiltInAgentKey | (string & {});

export type WorkspaceCreateInput = {
  idempotencyKey?: string;
  name?: string;
  /**
   * Caller-owned tags (e.g. tenant or channel ids). Up to 20 keys of letters,
   * digits, `_ . : -`; values up to 500 chars. Returned on the workspace and
   * filterable with `workspaces.list({ metadata })`.
   */
  metadata?: Record<string, string>;
  /**
   * Terminate automatically this long after creation, whatever its activity.
   * Between 1 minute and 30 days. Use it as a cost guardrail for ephemeral
   * workspaces in case the caller crashes before `terminate()`.
   */
  autoTerminateAfterMs?: number;
  /**
   * Run your own image instead of the catalog image. Registry-backed providers
   * (railway, aws, daytona, exedev) take an OCI reference such as
   * `ghcr.io/acme/agent-runner:1.4.0`; E2B takes a public template id or
   * alias. The managed service only runs images that can be pulled without
   * credentials, and pins floating tags to a digest at create time. Build on
   * `opeoginni/gitterm-opencode-server` and keep its entrypoint.
   */
  image?: string;
  repo: string;
  branch?: string;
  /** Commit SHA to pin the checkout to after cloning `branch`/`checkoutRef`. */
  baseCommit?: string;
  /** Branch or tag to clone when distinct from the display `branch`. Not a commit SHA — use `baseCommit` to pin a revision. */
  checkoutRef?: string;
  subdomain?: string;
  /** Stable agent key. Defaults to `opencode`. */
  agent?: AgentKey;
  /** Provider intent. Defaults to the user's or deployment's preferred provider. */
  provider?: WorkspaceProviderSelection;
  /** Inline Git credentials for repository validation, cloning, and runtime pull/push. */
  repositoryCredentials?: { username?: string; token: string };
  gitIntegrationId?: string;
  /** Defaults from the selected provider. */
  persistent?: boolean;
  workspaceProfile?: "standard" | "ssh-enabled";
  /**
   * One entry per provider. Omit entirely to inject the dashboard defaults.
   * Naming any dashboard credential (an entry without `apiKey`) turns off the
   * implicit defaults, so list every provider the workspace needs.
   */
  modelCredentials?: WorkspaceModelCredentialInput[];
  /** Ephemeral environment variables injected into this workspace only. */
  environmentVariables?: Record<string, string>;
  /**
   * Setup phases run in order. `beforeAgent` blocks agent startup and fails
   * create() when it exits non-zero; `afterAgent` starts after the agent is
   * reachable and is observable with setupStatus()/waitForSetup().
   */
  setup?: { beforeAgent?: string[]; afterAgent?: string[] };
  /** Secret files written relative to the repository and excluded from git. Rotate by recreating the workspace. */
  secretFiles?: Array<{ path: string; content: string; mode?: "0400" | "0600" }>;
  /** Trusted integration context appended to the workspace's global AGENTS.md. */
  additionalAgentInstructions?: string;
  /** OpenCode capabilities materialized only in this workspace. */
  opencode?: {
    skills?: Array<{ name: string; content: string }>;
    /** NPM package specs or plugin paths accepted by OpenCode. Pin versions for repeatable runs. */
    plugins?: string[];
    /**
     * OpenCode config (opencode.json keys) merged over your saved config for
     * this workspace only. e.g. { permission: { edit: "allow", bash: "allow",
     * webfetch: "allow" } } disables tool approval prompts in headless runs.
     */
    config?: Record<string, unknown>;
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
  context: { type: "isolated" } | { type: "continued"; runId: string };
  createdAt: string;
  /** When the prompt reached the agent; null while `pending`. */
  submittedAt: string | null;
  completedAt: string | null;
};

export type AgentRunListOptions = {
  /** `active` = pending/running/retrying; `terminal` = completed/failed/cancelled. */
  status?: "all" | "active" | "terminal";
  /** 1–50, default 20. */
  limit?: number;
  offset?: number;
};

export type AgentRunListResult = {
  runs: AgentRun[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
};

export type AgentRunCreateInput = {
  workspaceId: string;
  /**
   * Stable key used to return the same run when a request is retried.
   * Defaults to a random UUID, which gives no retry protection; pass your own
   * for anything a retry could duplicate.
   */
  idempotencyKey?: string;
  prompt: string;
  title?: string;
  agent?: string;
  /** OpenCode model in provider/model format. */
  model?: string;
  /** Start with fresh context (default), or continue a terminal run's context. */
  context?: { type: "isolated" } | { type: "continue"; runId: string };
  /**
   * Wait for the `afterAgent` setup phase to succeed before submitting the
   * prompt. Fails the call with the setup log if that phase failed.
   */
  waitForSetup?: boolean;
  /** How long to wait for setup, in ms. Server maximum is 600000 (10 minutes). */
  setupTimeoutMs?: number;
  /**
   * How long to wait for a `pending` workspace to become `running`, in ms.
   * Defaults to 120000; server maximum is 240000. Paused workspaces are not
   * resumed — call `workspaces.ensureRunning()` first.
   */
  startTimeoutMs?: number;
  /** Abort while waiting for setup or start; rejects with code `ABORTED`. */
  signal?: AbortSignal;
};

export type AgentRunMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      callId: string;
      tool: string;
      status: "pending" | "running" | "completed" | "error";
      title: string | null;
      input: Record<string, unknown>;
      /** Tool output when completed, truncated to 4000 characters. */
      output: string | null;
      error: string | null;
      startedAt: string | null;
      completedAt: string | null;
    };

export type AgentRunMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  completedAt: string | null;
  /** Concatenated text parts. */
  text: string;
  error: string | null;
  /** Ordered text and tool-call parts, for seeing what the agent actually did. */
  parts: AgentRunMessagePart[];
};

export type WorkspaceSetupStatus = {
  /**
   * `not_requested` — no `afterAgent` commands. `waiting` — the agent isn't
   * reachable yet, so setup hasn't started. `running`, `succeeded`, `failed`
   * describe the `afterAgent` phase itself. A setup stuck in `waiting` for
   * 15 minutes is marked `failed` with the reason in `log`.
   */
  status: "not_requested" | "waiting" | "running" | "succeeded" | "failed";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string | null;
};

/**
 * A model provider from the Gitterm registry. `name` is what credential
 * inputs reference; `authType` tells you whether it accepts inline API keys
 * ("api_key") or requires the dashboard OAuth flow ("oauth").
 */
export type ModelProviderInfo = {
  id: string;
  name: string;
  displayName: string;
  authType: string;
  isRecommended: boolean;
};

/**
 * Selects the credential for one provider on workspaces.create().
 * `providerName` comes from credentials.listProviders(), e.g. "anthropic" or
 * "openai"; unknown providers throw MODEL_CREDENTIAL_INVALID.
 *
 * - `{ providerName, apiKey }` — inline key for this workspace only, never
 *   stored. Overrides any dashboard credential for the same provider.
 *   OAuth-only providers throw MODEL_CREDENTIAL_INVALID.
 * - `{ providerName, label }` — the dashboard credential with that label.
 *   Unknown labels throw MODEL_CREDENTIAL_UNAVAILABLE listing the labels
 *   that exist.
 * - `{ providerName }` — that provider's dashboard default credential.
 */
export type WorkspaceModelCredentialInput =
  | { providerName: string; apiKey: string; label?: never }
  | { providerName: string; label?: string; apiKey?: never };

/** Safe dashboard credential metadata. Secret material is never returned by the SDK. */
export type ModelCredential = {
  id: string;
  providerId: string;
  providerName: string;
  providerDisplayName: string;
  logicalProviderKey: string;
  authType: string;
  /** Unique per provider; use it in `modelCredentials: [{ providerName, label }]`. */
  label: string;
  keyHash: string;
  isActive: boolean;
  isDefault: boolean;
  lastUsedAt: string | null;
  oauthExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
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
    /**
     * Whether workspaces on this provider can call the gitterm API from
     * inside the sandbox (scoped CLI, setup push reports, credential
     * refresh). False for e.g. Daytona Tier 1/2 organizations, where setup
     * status is reconciled by server-side polling instead.
     */
    workspaceApiAccess: boolean;
  }>;
};

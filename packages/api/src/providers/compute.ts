/**
 * Cloud-agnostic compute provider interface.
 * Implementations exist for Railway, AWS, Azure, etc.
 */

export type WorkspaceStatus = "pending" | "running" | "stopped" | "terminated";

export interface WorkspaceConfig {
  workspaceId: string;
  userId: string;
  imageId: string;
  subdomain: string;
  repositoryUrl?: string;
  regionIdentifier: string;
  environmentVariables?: Record<string, string | undefined>;
}

export interface PersistentWorkspaceConfig extends WorkspaceConfig {
  persistent: boolean;
}

export interface WorkspaceInfo {
  externalServiceId: string;
  upstreamUrl: string; // URL to proxy requests to (e.g., Railway internal URL)
  domain: string;
  serviceCreatedAt: Date;
}

export interface PersistentWorkspaceInfo extends WorkspaceInfo {
  externalVolumeId: string;
  volumeCreatedAt: Date;
}

export interface WorkspaceStatusResult {
  status: WorkspaceStatus;
  lastActiveAt?: Date;
}

export interface ComputeProvider {
  /**
   * Provider name identifier (e.g., "railway", "aws", "azure")
   */
  readonly name: string;

  /**
   * Create a new workspace instance
   */
  createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo>;

  /**
   * Create a new persistent workspace instance (with a volume)
   */
  createPersistentWorkspace(config: PersistentWorkspaceConfig): Promise<PersistentWorkspaceInfo>;

  /**
   * Stop a workspace (scale to 0 replicas, but keep resources)
   */
  stopWorkspace(
    externalId: string,
    regionIdentifier: string,
    externalRunningDeploymentId?: string,
  ): Promise<void>;

  /**
   * Restart a stopped workspace (scale back up)
   */
  restartWorkspace(
    externalId: string,
    regionIdentifier: string,
    externalRunningDeploymentId?: string,
  ): Promise<void>;

  /**
   * Permanently delete/terminate a workspace
   */
  terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void>;

  /**
   * Get current status of a workspace
   */
  getStatus(externalId: string): Promise<WorkspaceStatusResult>;
}

export interface StartSandboxRunConfig {
  /** Unique identifier for this sandbox instance */
  sandboxId: string;
  /** Repository owner (e.g., "octocat") */
  repoOwner: string;
  /** Repository name (e.g., "hello-world") */
  repoName: string;
  /** Branch to work on */
  branch: string;
  /** GitHub App installation token for git operations */
  gitAuthToken: string;
  /** Path to the plan/feature list file in the repo */
  planFilePath: string;
  /** Path to the progress file in the repo (optional) */
  documentedProgressPath?: string;
  /** AI provider (e.g., "anthropic", "openai") */
  provider: string;
  /** Model identifier (e.g., "anthropic/claude-sonnet-4-20250514") */
  model: string;
  /** API key for the AI provider */
  apiKey: string;
  /** Custom prompt to send to the agent */
  prompt: string;
  /** Iteration number for the session */
  iteration: number;
  /** Callback URL for async completion notification */
  callbackUrl?: string;
  /** Secret for authenticating callback requests */
  callbackSecret?: string;
  /** Run ID for callback identification */
  runId?: string;
}

export interface SandboxProvider {
  readonly name: string;
}

/**
 * Legacy type for Cloudflare worker compatibility
 * Maps to StartSandboxRunConfig with different field names
 */
export interface SandboxConfig {
  userSandboxId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  gitAuthToken: string;
  featureListPath: string;
  documentedProgressPath?: string;
  model: string;
  apiKey: string;
  prompt: string;
  iteration: number;
  /** Callback URL for async completion notification */
  callbackUrl?: string;
  /** Secret for authenticating callback requests */
  callbackSecret?: string;
  /** Run ID for callback identification */
  runId?: string;
}

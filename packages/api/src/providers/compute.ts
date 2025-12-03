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

export interface WorkspaceInfo {
  externalId: string;
  backendUrl: string;
  domain: string;
  createdAt: Date;
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
   * Start/create a new workspace instance
   */
  startWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo>;

  /**
   * Stop a workspace (scale to 0 replicas, but keep resources)
   */
  stopWorkspace(externalId: string, regionIdentifier: string): Promise<void>;

  /**
   * Restart a stopped workspace (scale back up)
   */
  restartWorkspace(externalId: string, regionIdentifier: string): Promise<void>;

  /**
   * Permanently delete/terminate a workspace
   */
  terminateWorkspace(externalId: string): Promise<void>;

  /**
   * Get current status of a workspace
   */
  getStatus(externalId: string): Promise<WorkspaceStatusResult>;
}


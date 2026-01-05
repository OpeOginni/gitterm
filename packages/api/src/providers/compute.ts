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
  stopWorkspace(externalId: string, regionIdentifier: string, externalRunningDeploymentId?: string): Promise<void>;

  /**
   * Restart a stopped workspace (scale back up)
   */
  restartWorkspace(externalId: string, regionIdentifier: string, externalRunningDeploymentId?: string): Promise<void>;

  /**
   * Permanently delete/terminate a workspace
   */
  terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void>;

  /**
   * Get current status of a workspace
   */
  getStatus(externalId: string): Promise<WorkspaceStatusResult>;
}


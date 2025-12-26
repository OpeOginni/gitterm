import type { ComputeProvider, WorkspaceConfig, WorkspaceInfo, PersistentWorkspaceConfig, PersistentWorkspaceInfo, WorkspaceStatusResult } from "../compute";
import { getWorkspaceDomain } from "../../utils/routing";

/**
 * Local Provider Implementation
 * 
 * This provider handles local tunnel workspaces where the compute runs on the user's machine.
 * Most operations are no-ops since there are no actual cloud resources to manage.
 * 
 * Lifecycle:
 * - createWorkspace: Just returns metadata (no cloud resources created)
 * - stopWorkspace: No-op (tunnel disconnect handles this)
 * - restartWorkspace: No-op (tunnel reconnect handles this)
 * - terminateWorkspace: No-op (just marks as terminated in DB)
 */
class LocalProvider implements ComputeProvider {
  readonly name = "local";

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    // For local workspaces, we don't create any cloud resources
    // The workspace ID becomes the external service ID
    const externalServiceId = `local-${config.workspaceId}`;
    
    // Domain is constructed from subdomain using routing utils
    // Returns subdomain.baseDomain (e.g., ws-abc123.gitterm.dev)
    const domain = getWorkspaceDomain(config.subdomain);
    
    return {
      externalServiceId,
      backendUrl: "", // Local workspaces don't have a backend URL until tunnel connects
      domain,
      serviceCreatedAt: new Date(),
    };
  }

  async createPersistentWorkspace(config: PersistentWorkspaceConfig): Promise<PersistentWorkspaceInfo> {
    // Local workspaces don't support persistent volumes yet
    // This could be implemented in the future to use local directories
    throw new Error("Persistent volumes are not supported for local workspaces");
  }

  async stopWorkspace(externalId: string, regionIdentifier: string, externalRunningDeploymentId?: string): Promise<void> {
    // No-op: Local workspaces are stopped when the tunnel disconnects
    // The tunnel-proxy handles updating the workspace status
    console.log(`[LocalProvider] stopWorkspace called for ${externalId} (no-op)`);
  }

  async restartWorkspace(externalId: string, regionIdentifier: string, externalRunningDeploymentId?: string): Promise<void> {
    // No-op: Local workspaces are restarted when the tunnel reconnects
    console.log(`[LocalProvider] restartWorkspace called for ${externalId} (no-op)`);
  }

  async terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void> {
    // No-op: Local workspaces don't have cloud resources to clean up
    // The database cleanup is handled by the workspace management logic
    console.log(`[LocalProvider] terminateWorkspace called for ${externalServiceId} (no-op)`);
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    // For local workspaces, status is always determined by tunnel connection state
    // This method shouldn't be called in practice, but return a safe default
    return {
      status: "stopped",
    };
  }
}

export const localProvider = new LocalProvider();

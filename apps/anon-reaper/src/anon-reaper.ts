import "dotenv/config";
import { getInternalClient } from "@gitterm/api/client/internal";
import { deploymentConfig } from "@gitterm/api/config";

async function main() {
  if (!deploymentConfig.isManaged) {
    console.log("[anon-reaper] Skipping outside managed deployments");
    return;
  }

  console.log("[anon-reaper] Checking for expired anonymous workspaces...");
  const internalClient = getInternalClient();
  const workspaces = await internalClient.internal.getAnonStragglerWorkspaces.query();

  for (const workspace of workspaces) {
    try {
      await internalClient.internal.terminateWorkspaceInternal.mutate({
        workspaceId: workspace.id,
      });
      console.log(`[anon-reaper] Terminated workspace ${workspace.id}`);
    } catch (error) {
      console.error(`[anon-reaper] Failed to terminate workspace ${workspace.id}:`, error);
    }
  }

  console.log(`[anon-reaper] Completed. Found ${workspaces.length} expired workspace(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[anon-reaper] Fatal error:", error);
    process.exit(1);
  });

import "dotenv/config";
import { internalClient } from "@gitpad/api/client/internal";

/**
 * Idle Reaper Worker
 * 
 * Finds workspaces that have been idle beyond the timeout threshold
 * and stops them to save resources and track billing.
 * 
 * Runs as a Railway cron job every 10 minutes.
 */
async function main() {
  console.log("[idle-reaper] Starting idle workspace check...");
  
  try {
    const idleWorkspaces = await internalClient.internal.getIdleWorkspaces.query();
    
    if (idleWorkspaces.length === 0) {
      console.log("[idle-reaper] No idle workspaces found");
      return 0;
    }

    console.log(`[idle-reaper] Found ${idleWorkspaces.length} idle workspace(s)`);

    let stoppedCount = 0;

    for (const ws of idleWorkspaces) {
      try {
        console.log(`[idle-reaper] Stopping workspace ${ws.id}...`);

        // Stop workspace via internal API
        const result = await internalClient.internal.stopWorkspaceInternal.mutate({
          workspaceId: ws.id,
          stopSource: "idle",
        });

        console.log(`[idle-reaper] Workspace ${ws.id} stopped, duration: ${result.durationMinutes} minutes`);
        stoppedCount++;
      } catch (error) {
        console.error(`[idle-reaper] Failed to stop workspace ${ws.id}:`, error);
      }
    }

    console.log(`[idle-reaper] Completed. Stopped ${stoppedCount}/${idleWorkspaces.length} workspaces`);
    process.exit(0);
  } catch (error) {
    console.error("[idle-reaper] Error running idle reaper:", error);
    process.exit(1);
  }
}

// Run the job
main();

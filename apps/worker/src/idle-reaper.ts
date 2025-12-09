import "dotenv/config";
import { internalClient } from "@gitpad/api/client/internal";

/**
 * Idle Reaper Worker
 * 
 * This worker performs two main functions:
 * 1. Finds workspaces that have been idle beyond the timeout threshold and stops them
 * 2. Finds workspaces belonging to users who have exhausted their quota and stops them
 * 
 * Runs as a Railway cron job every 10 minutes.
 * 
 * NOTE: The quota enforcement section can be commented out when moving from trial to paid plans.
 */

// ============================================================================
// TRIAL/FREE TIER ENFORCEMENT - Comment out this section for paid plans
// ============================================================================
const ENABLE_QUOTA_ENFORCEMENT = true; // Set to false to disable quota checks
// ============================================================================

async function main() {
  console.log("[idle-reaper] Starting workspace reaper...");
  
  let totalStopped = 0;
  
  try {
    // ========================================================================
    // 1. Stop idle workspaces (always active)
    // ========================================================================
    console.log("[idle-reaper] Checking for idle workspaces...");
    const idleWorkspaces = await internalClient.internal.getIdleWorkspaces.query();
    
    if (idleWorkspaces.length === 0) {
      console.log("[idle-reaper] No idle workspaces found");
    } else {
      console.log(`[idle-reaper] Found ${idleWorkspaces.length} idle workspace(s)`);

      for (const ws of idleWorkspaces) {
        try {
          console.log(`[idle-reaper] Stopping idle workspace ${ws.id}...`);

          const result = await internalClient.internal.stopWorkspaceInternal.mutate({
            workspaceId: ws.id,
            stopSource: "idle",
          });

          console.log(`[idle-reaper] ✓ Workspace ${ws.id} stopped (idle), duration: ${result.durationMinutes} minutes`);
          totalStopped++;
        } catch (error) {
          console.error(`[idle-reaper] ✗ Failed to stop idle workspace ${ws.id}:`, error);
        }
      }
    }

    // ========================================================================
    // 2. Stop workspaces for users who exceeded quota (trial enforcement)
    // ========================================================================
    // COMMENT OUT THIS ENTIRE BLOCK WHEN MOVING TO PAID PLANS
    if (ENABLE_QUOTA_ENFORCEMENT) {
      console.log("[idle-reaper] Checking for quota-exceeded workspaces...");
      
      try {
        const quotaWorkspaces = await internalClient.internal.getQuotaExceededWorkspaces.query();
        
        if (quotaWorkspaces.length === 0) {
          console.log("[idle-reaper] No quota-exceeded workspaces found");
        } else {
          console.log(`[idle-reaper] Found ${quotaWorkspaces.length} workspace(s) with exceeded quota`);

          for (const ws of quotaWorkspaces) {
            try {
              console.log(`[idle-reaper] Stopping workspace ${ws.id} (user ${ws.userId} exceeded quota)...`);

              const result = await internalClient.internal.stopWorkspaceInternal.mutate({
                workspaceId: ws.id,
                stopSource: "quota_exhausted",
              });

              console.log(`[idle-reaper] ✓ Workspace ${ws.id} stopped (quota), duration: ${result.durationMinutes} minutes`);
              totalStopped++;
            } catch (error) {
              console.error(`[idle-reaper] ✗ Failed to stop quota-exceeded workspace ${ws.id}:`, error);
            }
          }
        }
      } catch (error) {
        console.error("[idle-reaper] Error checking quota-exceeded workspaces:", error);
        // Don't fail the entire job if quota check fails
      }
    } else {
      console.log("[idle-reaper] Quota enforcement disabled (ENABLE_QUOTA_ENFORCEMENT=false)");
    }
    // END OF QUOTA ENFORCEMENT BLOCK
    // ========================================================================

    console.log(`[idle-reaper] Completed. Total workspaces stopped: ${totalStopped}`);
    process.exit(0);
  } catch (error) {
    console.error("[idle-reaper] Fatal error:", error);
    process.exit(1);
  }
}

// Run the job
main();

import "dotenv/config";
import { getInternalClient } from "@gitterm/api/client/internal";
import { features } from "@gitterm/api/config";

/**
 * Idle Reaper Worker
 *
 * This worker performs two main functions:
 * 1. Finds workspaces that have been idle beyond the timeout threshold and stops them
 * 2. Finds workspaces belonging to users who have exhausted their quota and stops them
 *
 * Runs as a Railway cron job every 10 minutes.
 *
 * Feature flags (controlled via environment):
 * - ENABLE_IDLE_REAPING: Controls idle workspace reaping (default: true)
 * - ENABLE_QUOTA_ENFORCEMENT: Controls quota checking (default: true in managed mode)
 */

async function main() {
  console.log("[idle-reaper] Starting workspace reaper...");
  console.log(`[idle-reaper] Idle reaping: ${features.idleReaping ? "enabled" : "disabled"}`);
  console.log(`[idle-reaper] Quota enforcement: ${features.quotaEnforcement ? "enabled" : "disabled"}`);

  let totalStopped = 0;

  try {
    const internalClient = getInternalClient();
    // ========================================================================
    // 1. Stop idle workspaces (controlled by ENABLE_IDLE_REAPING)
    // ========================================================================
    if (features.idleReaping) {
      console.log("[idle-reaper] Checking for idle workspaces...");
      const idleWorkspaces =
        await internalClient.internal.getIdleWorkspaces.query();

      if (idleWorkspaces.length === 0) {
        console.log("[idle-reaper] No idle workspaces found");
      } else {
        console.log(
          `[idle-reaper] Found ${idleWorkspaces.length} idle workspace(s)`
        );

        for (const ws of idleWorkspaces) {
          try {
            console.log(`[idle-reaper] Stopping idle workspace ${ws.id}...`);

            const result =
              await internalClient.internal.stopWorkspaceInternal.mutate({
                workspaceId: ws.id,
                stopSource: "idle",
              });

            console.log(
              `[idle-reaper] Workspace ${ws.id} stopped (idle), duration: ${result.durationMinutes} minutes`
            );
            totalStopped++;
          } catch (error) {
            console.error(
              `[idle-reaper] Failed to stop idle workspace ${ws.id}:`,
              error
            );
          }
        }
      }
    } else {
      console.log("[idle-reaper] Idle reaping disabled, skipping...");
    }

    // ========================================================================
    // 2. Stop workspaces for users who exceeded quota (managed mode only)
    // ========================================================================
    if (features.quotaEnforcement) {
      console.log("[idle-reaper] Checking for quota-exceeded workspaces...");

      try {
        const quotaWorkspaces =
          await internalClient.internal.getQuotaExceededWorkspaces.query();

        if (quotaWorkspaces.length === 0) {
          console.log("[idle-reaper] No quota-exceeded workspaces found");
        } else {
          console.log(
            `[idle-reaper] Found ${quotaWorkspaces.length} workspace(s) with exceeded quota`
          );

          for (const ws of quotaWorkspaces) {
            try {
              console.log(
                `[idle-reaper] Stopping workspace ${ws.id} (user ${ws.userId} exceeded quota)...`
              );

              const result =
                await internalClient.internal.stopWorkspaceInternal.mutate({
                  workspaceId: ws.id,
                  stopSource: "quota_exhausted",
                });

              console.log(
                `[idle-reaper] Workspace ${ws.id} stopped (quota), duration: ${result.durationMinutes} minutes`
              );
              totalStopped++;
            } catch (error) {
              console.error(
                `[idle-reaper] Failed to stop quota-exceeded workspace ${ws.id}:`,
                error
              );
            }
          }
        }
      } catch (error) {
        console.error(
          "[idle-reaper] Error checking quota-exceeded workspaces:",
          error
        );
        // Don't fail the entire job if quota check fails
      }
    } else {
      console.log(
        "[idle-reaper] Quota enforcement disabled (self-hosted mode or ENABLE_QUOTA_ENFORCEMENT=false)"
      );
    }

    // ========================================================================
    // 3. Terminate workspaces that have not been reached or used in 4 days
    // ========================================================================
    if (features.idleReaping) {
      console.log("[idle-reaper] Checking for workspaces that have not been reached or used in 4 days...");
      const workspaces = await internalClient.internal.getLongTermInactiveWorkspaces.query();
      if (workspaces.length === 0) {
        console.log("[idle-reaper] No workspaces found that have not been reached or used in 4 days");
      } else {
        console.log(`[idle-reaper] Found ${workspaces.length} workspace(s) that have not been reached or used in 4 days`);
      }
      for (const ws of workspaces) {
        try {
          console.log(`[idle-reaper] Terminating workspace ${ws.id}...`);
          await internalClient.internal.terminateWorkspaceInternal.mutate({ workspaceId: ws.id });
          console.log(`[idle-reaper] Workspace ${ws.id} terminated`);
          totalStopped++;
        } catch (error) {
          console.error(`[idle-reaper] Failed to terminate workspace ${ws.id}:`, error);
        }
      }
    }


    console.log(
      `[idle-reaper] Completed. Total workspaces stopped: ${totalStopped}`
    );
    process.exit(0);
  } catch (error) {
    console.error("[idle-reaper] Fatal error:", error);
    process.exit(1);
  }
}

// Run the job
main();

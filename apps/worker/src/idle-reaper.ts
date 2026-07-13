import "dotenv/config";
import { getInternalClient } from "@gitterm/api/client/internal";
import { features } from "@gitterm/api/config";

/**
 * Idle Reaper Worker
 *
 * This worker pauses idle/quota-exhausted workspaces, then permanently removes
 * paused workspaces after their plan's retention window expires.
 *
 *
 * Feature flags (controlled via environment):
 * - ENABLE_IDLE_REAPING: Controls idle workspace reaping (default: true)
 * - ENABLE_QUOTA_ENFORCEMENT: Controls quota checking (default: true in managed mode)
 */

async function main() {
  console.log("[idle-reaper] Starting workspace reaper...");
  console.log(`[idle-reaper] Idle reaping: ${features.idleReaping ? "enabled" : "disabled"}`);
  console.log(
    `[idle-reaper] Quota enforcement: ${features.quotaEnforcement ? "enabled" : "disabled"}`,
  );

  let totalTransitions = 0;

  try {
    const internalClient = getInternalClient();
    // ========================================================================
    // 1. Pause idle workspaces (controlled by ENABLE_IDLE_REAPING)
    // ========================================================================
    if (features.idleReaping) {
      console.log("[idle-reaper] Checking for idle workspaces...");
      const idleWorkspaces = await internalClient.internal.getIdleWorkspaces.query();

      if (idleWorkspaces.length === 0) {
        console.log("[idle-reaper] No idle workspaces found");
      } else {
        console.log(`[idle-reaper] Found ${idleWorkspaces.length} idle workspace(s)`);

        for (const ws of idleWorkspaces) {
          try {
            console.log(`[idle-reaper] Pausing idle workspace ${ws.id}...`);

            const result = await internalClient.internal.pauseWorkspaceInternal.mutate({
              workspaceId: ws.id,
              stopSource: "idle",
            });

            console.log(
              `[idle-reaper] Workspace ${ws.id} paused (idle), duration: ${result.durationMinutes} minutes`,
            );
            totalTransitions++;
          } catch (error) {
            console.error(`[idle-reaper] Failed to pause idle workspace ${ws.id}:`, error);
          }
        }
      }
    } else {
      console.log("[idle-reaper] Idle reaping disabled, skipping...");
    }

    // ========================================================================
    // 2. Pause workspaces for users who exceeded quota (managed mode only)
    // ========================================================================
    if (features.quotaEnforcement) {
      console.log("[idle-reaper] Checking for quota-exceeded workspaces...");

      try {
        const quotaWorkspaces = await internalClient.internal.getQuotaExceededWorkspaces.query();

        if (quotaWorkspaces.length === 0) {
          console.log("[idle-reaper] No quota-exceeded workspaces found");
        } else {
          console.log(
            `[idle-reaper] Found ${quotaWorkspaces.length} workspace(s) with exceeded quota`,
          );

          for (const ws of quotaWorkspaces) {
            try {
              console.log(
                `[idle-reaper] Pausing workspace ${ws.id} (user ${ws.userId} exceeded quota)...`,
              );

              const result = await internalClient.internal.pauseWorkspaceInternal.mutate({
                workspaceId: ws.id,
                stopSource: "quota_exhausted",
              });

              console.log(
                `[idle-reaper] Workspace ${ws.id} paused (quota), duration: ${result.durationMinutes} minutes`,
              );
              totalTransitions++;
            } catch (error) {
              console.error(
                `[idle-reaper] Failed to pause quota-exceeded workspace ${ws.id}:`,
                error,
              );
            }
          }
        }
      } catch (error) {
        console.error("[idle-reaper] Error checking quota-exceeded workspaces:", error);
        // Don't fail the entire job if quota check fails
      }
    } else {
      console.log(
        "[idle-reaper] Quota enforcement disabled (self-hosted mode or ENABLE_QUOTA_ENFORCEMENT=false)",
      );
    }

    try {
      console.log("[idle-reaper] Checking for anon try-gitterm stragglers...");
      const stragglers = await internalClient.internal.getAnonStragglerWorkspaces.query();
      if (stragglers.length === 0) {
        console.log("[idle-reaper] No anon stragglers found");
      } else {
        console.log(`[idle-reaper] Found ${stragglers.length} anon straggler workspace(s)`);
        for (const ws of stragglers) {
          try {
            console.log(`[idle-reaper] Terminating anon straggler ${ws.id}...`);
            await internalClient.internal.terminateWorkspaceInternal.mutate({
              workspaceId: ws.id,
            });
            console.log(`[idle-reaper] Anon workspace ${ws.id} terminated`);
            totalTransitions++;
          } catch (error) {
            console.error(`[idle-reaper] Failed to terminate anon straggler ${ws.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("[idle-reaper] Anon straggler check failed:", error);
    }

    // ========================================================================
    // 3. Terminate workspaces that remained paused for the full retention window.
    // ========================================================================
    if (features.idleReaping) {
      console.log(
        "[idle-reaper] Checking for workspaces inactive beyond their plan's retention window...",
      );
      const workspaces = await internalClient.internal.getLongTermInactiveWorkspaces.query();
      if (workspaces.length === 0) {
        console.log("[idle-reaper] No workspaces found beyond their plan's retention window");
      } else {
        console.log(
          `[idle-reaper] Found ${workspaces.length} workspace(s) beyond their plan's retention window`,
        );
      }
      for (const ws of workspaces) {
        try {
          console.log(`[idle-reaper] Terminating expired paused workspace ${ws.id}...`);
          await internalClient.internal.terminateWorkspaceInternal.mutate({
            workspaceId: ws.id,
            requirePaused: true,
          });
          console.log(`[idle-reaper] Workspace ${ws.id} terminated after retention expiry`);
          totalTransitions++;
        } catch (error) {
          console.error(`[idle-reaper] Failed to terminate workspace ${ws.id}:`, error);
        }
      }
    }

    // ========================================================================
    // 4. Retry AWS cleanup for terminated workspaces and sweep leftovers
    // ========================================================================
    try {
      const sweepResult = await internalClient.internal.sweepAwsResourcesInternal.mutate();
      console.log(
        `[idle-reaper] AWS orphan cleanup complete (retried workspaces: ${sweepResult.retriedWorkspaces}, services: ${sweepResult.servicesDeleted}, task definitions: ${sweepResult.taskDefinitionsDeregistered}, rules: ${sweepResult.rulesDeleted}, target groups: ${sweepResult.targetGroupsDeleted}, access points: ${sweepResult.accessPointsDeleted})`,
      );
    } catch (error) {
      console.error("[idle-reaper] AWS orphan cleanup failed:", error);
    }

    console.log(`[idle-reaper] Completed. Total lifecycle transitions: ${totalTransitions}`);
    process.exit(0);
  } catch (error) {
    console.error("[idle-reaper] Fatal error:", error);
    process.exit(1);
  }
}

// Run the job
main();

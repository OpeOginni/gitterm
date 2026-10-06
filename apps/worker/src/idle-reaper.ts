import "dotenv/config";
import { getInternalClient } from "@gitterm/api/client/internal";
import { features } from "@gitterm/api/config";

/**
 * Idle Reaper Worker
 *
 * This worker pauses idle/quota-exhausted workspaces, then permanently removes
 * paused workspaces after their plan's retention window expires.
 *
 * Two modes (controlled by REAP_INTERVAL_MINUTES):
 * - "0" (default): run once and exit. For Railway Cron, which handles
 *   scheduling via `cronSchedule` in railway.config.json. This is the cheapest
 *   option on usage-billed platforms (pay per execution, not per uptime).
 * - ">0": loop forever, sleeping that many minutes between passes. For
 *   self-hosted Docker Compose, where the container stays up and there is no
 *   external cron. Idle CPU/RAM cost is negligible (~0 while sleeping).
 *
 * Feature flags (controlled via environment):
 * - ENABLE_IDLE_REAPING: Controls idle workspace reaping (default: true)
 * - REAP_INTERVAL_MINUTES: Minutes between passes, 0 = run once (default: 0)
 */

const REAP_INTERVAL_MINUTES = (() => {
  const raw = process.env.REAP_INTERVAL_MINUTES;
  if (raw === undefined || raw.trim() === "") return 0;
  const parsed = parseInt(raw.trim(), 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    console.warn(
      `[idle-reaper] Invalid REAP_INTERVAL_MINUTES="${raw}", falling back to 0 (run once)`,
    );
    return 0;
  }
  return parsed;
})();

let shuttingDown = false;
process.on("SIGTERM", () => {
  console.log("[idle-reaper] Received SIGTERM, shutting down after current pass...");
  shuttingDown = true;
});
process.on("SIGINT", () => {
  console.log("[idle-reaper] Received SIGINT, shutting down after current pass...");
  shuttingDown = true;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOnce() {
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
    // 2. Pause workspaces for users who exceeded quota (none without billing)
    // ========================================================================
    {
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
    }

    // ========================================================================
    // 2b. Keep always-on workspaces' provider leases fresh, then run billing:
    //     report usage and email usage alerts (no-ops without billing).
    // ========================================================================
    try {
      const { renewed } = await internalClient.internal.keepAlwaysOnWorkspacesAlive.mutate();
      if (renewed > 0) console.log(`[idle-reaper] Renewed ${renewed} always-on workspace lease(s)`);
    } catch (error) {
      console.error("[idle-reaper] Failed to renew always-on workspace leases:", error);
    }
    try {
      const { notices, sent } = await internalClient.internal.runBillingTasks.mutate();
      if (notices > 0) console.log(`[idle-reaper] Billing alerts: ${sent}/${notices} sent`);
    } catch (error) {
      console.error("[idle-reaper] Billing tasks failed:", error);
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
    // 3b. Terminate workspaces whose caller-set lifetime (autoTerminateAfterMs)
    //     has elapsed. Explicit intent, so not gated by idle reaping.
    // ========================================================================
    {
      const dueWorkspaces = await internalClient.internal.getAutoTerminateDueWorkspaces.query();
      if (dueWorkspaces.length > 0) {
        console.log(`[idle-reaper] Found ${dueWorkspaces.length} workspace(s) past their lifetime`);
      }
      for (const ws of dueWorkspaces) {
        try {
          console.log(`[idle-reaper] Terminating workspace ${ws.id} (lifetime elapsed)...`);
          await internalClient.internal.terminateWorkspaceInternal.mutate({ workspaceId: ws.id });
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
        `[idle-reaper] AWS orphan cleanup complete (retried workspaces: ${sweepResult.retriedWorkspaces}, secrets: ${sweepResult.runtimeSecretsDeleted}, services: ${sweepResult.servicesDeleted}, task definitions: ${sweepResult.taskDefinitionsDeregistered}, rules: ${sweepResult.rulesDeleted}, target groups: ${sweepResult.targetGroupsDeleted}, access points: ${sweepResult.accessPointsDeleted}, failed deletions: ${sweepResult.cleanupFailures.length}, unresolved workspaces: ${sweepResult.unresolvedCleanupCount})`,
      );
      for (const failure of sweepResult.cleanupFailures) {
        console.error(
          `[idle-reaper] AWS cleanup failed for ${failure.resource}: ${failure.reason}`,
        );
      }
    } catch (error) {
      console.error("[idle-reaper] AWS orphan cleanup failed:", error);
    }

    console.log(`[idle-reaper] Pass completed. Lifecycle transitions: ${totalTransitions}`);
    return totalTransitions;
  } catch (error) {
    console.error("[idle-reaper] Pass failed:", error);
    throw error;
  }
}

async function main() {
  console.log("[idle-reaper] Starting workspace reaper...");
  console.log(`[idle-reaper] Idle reaping: ${features.idleReaping ? "enabled" : "disabled"}`);

  // Run-once mode for external schedulers (Railway Cron).
  if (REAP_INTERVAL_MINUTES <= 0) {
    console.log("[idle-reaper] Mode: run-once (REAP_INTERVAL_MINUTES=0)");
    try {
      await runOnce();
      process.exit(0);
    } catch {
      process.exit(1);
    }
    return;
  }

  // Loop mode for self-hosted Docker (no external cron).
  console.log(
    `[idle-reaper] Mode: loop every ${REAP_INTERVAL_MINUTES} minute(s). Set REAP_INTERVAL_MINUTES=0 for run-once (cron) mode.`,
  );
  let pass = 0;
  for (;;) {
    if (shuttingDown) {
      console.log("[idle-reaper] Shutdown requested, exiting...");
      process.exit(0);
    }
    pass++;
    console.log(`[idle-reaper] Starting pass #${pass}...`);
    try {
      await runOnce();
    } catch {
      // Errors already logged per-pass; keep the loop alive so one bad pass
      // doesn't stop reaping. Exit only on shutdown signal.
    }
    if (shuttingDown) {
      console.log("[idle-reaper] Shutdown requested, exiting...");
      process.exit(0);
    }
    console.log(
      `[idle-reaper] Sleeping ${REAP_INTERVAL_MINUTES} minute(s) until pass #${pass + 1}...`,
    );
    await sleep(REAP_INTERVAL_MINUTES * 60_000);
  }
}

// Run the job
main();

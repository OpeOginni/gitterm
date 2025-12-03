import "dotenv/config";
import { Hono } from "hono";
import { internalClient } from "@gitpad/api/client/internal";

// Idle reaper interval (10 minutes)
// Runs ~144 times/day, doubles as lightweight cron
const IDLE_REAPER_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Idle Reaper Worker
 * 
 * Finds workspaces that have been idle beyond the timeout threshold
 * and stops them to save resources and track billing.
 */
export async function runIdleReaper(): Promise<number> {
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
    return stoppedCount;
  } catch (error) {
    console.error("[idle-reaper] Error running idle reaper:", error);
    throw error;
  }
}

// Long-running service setup
const app = new Hono();

app.get("/health", (c) => c.text("OK"));
app.get("/", (c) => c.text("Idle Reaper running"));

let isShuttingDown = false;

async function startIdleReaperLoop() {
  console.log("[idle-reaper] Starting idle reaper loop...");
  
  while (!isShuttingDown) {
    try {
      await runIdleReaper();
    } catch (error) {
      console.error("[idle-reaper] Error in loop:", error);
    }
    
    // Wait for next interval
    await new Promise((resolve) => setTimeout(resolve, IDLE_REAPER_INTERVAL_MS));
  }
  
  console.log("[idle-reaper] Loop stopped");
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("[idle-reaper] Received SIGTERM, shutting down...");
  isShuttingDown = true;
});

process.on("SIGINT", () => {
  console.log("[idle-reaper] Received SIGINT, shutting down...");
  isShuttingDown = true;
});

// Start the loop when running as main
if (import.meta.main) {
  startIdleReaperLoop();
}

export default {
  port: process.env.PORT || 3003,
  fetch: app.fetch,
};

import "dotenv/config";
import { internalClient } from "@gitpad/api/client/internal";

/**
 * Daily Reset Worker
 * 
 * Run once per day (via cron) to:
 * 1. Log yesterday's usage stats
 * 2. Optionally archive old records
 * 
 * Note: Daily usage records are created on-demand when users start workspaces,
 * so we don't need to pre-create them. This job is mainly for observability.
 * 
 * Runs as a Railway cron job once per day at midnight UTC.
 */
async function main() {
  console.log("[daily-reset] Starting daily reset...");
  
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0]!;

    // Get yesterday's usage stats via internal API
    const stats = await internalClient.internal.getDailyStats.query({ date: yesterdayStr });

    console.log(`[daily-reset] Yesterday's stats (${stats.date}):`);
    console.log(`  - Active users: ${stats.users.total}`);
    console.log(`  - Total minutes used: ${stats.users.totalMinutes}`);
    console.log(`  - Total sessions: ${stats.sessions.total}`);
    console.log(`  - Avg duration: ${stats.sessions.avgDuration} minutes`);
    console.log(`  - Manual stops: ${stats.sessions.manualStops}`);
    console.log(`  - Idle stops: ${stats.sessions.idleStops}`);
    console.log(`  - Quota stops: ${stats.sessions.quotaStops}`);

    console.log("[daily-reset] Daily reset completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("[daily-reset] Error running daily reset:", error);
    process.exit(1);
  }
}

// Run the job
main();


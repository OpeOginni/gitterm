import { db, eq, and, sql } from "@gitpad/db";
import { dailyUsage, usageSession, workspace, type SessionStopSource } from "@gitpad/db/schema/workspace";
import { logger } from "./logger";

// Free tier: 60 minutes per day
export const FREE_TIER_DAILY_MINUTES = 60;
// Idle timeout: 30 minutes of no heartbeat
// Users can step away, read docs, think without losing workspace
export const IDLE_TIMEOUT_MINUTES = 30;

/**
 * Get or create daily usage record for a user
 */
export async function getOrCreateDailyUsage(userId: string): Promise<{ minutesUsed: number; minutesRemaining: number }> {
  const today = new Date().toISOString().split("T")[0]!; // YYYY-MM-DD

  const [existing] = await db
    .select()
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, today)));

  if (existing) {
    return {
      minutesUsed: existing.minutesUsed,
      minutesRemaining: Math.max(0, FREE_TIER_DAILY_MINUTES - existing.minutesUsed),
    };
  }

  // Create new daily usage record
  const [created] = await db
    .insert(dailyUsage)
    .values({
      userId,
      date: today,
      minutesUsed: 0,
    })
    .returning();

  return {
    minutesUsed: created!.minutesUsed,
    minutesRemaining: FREE_TIER_DAILY_MINUTES,
  };
}

/**
 * Check if user has remaining daily quota
 */
export async function hasRemainingQuota(userId: string): Promise<boolean> {
  const usage = await getOrCreateDailyUsage(userId);
  if (usage.minutesRemaining <= 0) {
    logger.quotaExhausted(userId);
  }
  return usage.minutesRemaining > 0;
}

/**
 * Create a new usage session when workspace starts
 */
export async function createUsageSession(workspaceId: string, userId: string): Promise<string> {
  const [session] = await db
    .insert(usageSession)
    .values({
      workspaceId,
      userId,
      startedAt: new Date(),
    })
    .returning();

  return session!.id;
}

/**
 * Close a usage session and update daily usage
 */
export async function closeUsageSession(
  workspaceId: string,
  stopSource: SessionStopSource
): Promise<{ durationMinutes: number }> {
  const now = new Date();

  // Find the open session for this workspace
  const [openSession] = await db
    .select()
    .from(usageSession)
    .where(
      and(
        eq(usageSession.workspaceId, workspaceId),
        sql`${usageSession.stoppedAt} IS NULL`
      )
    );

  if (!openSession) {
    console.warn(`No open session found for workspace ${workspaceId}`);
    return { durationMinutes: 0 };
  }

  // Calculate duration
  const durationMs = now.getTime() - openSession.startedAt.getTime();
  const durationMinutes = Math.ceil(durationMs / 60000); // Round up to nearest minute

  // Update the session
  await db
    .update(usageSession)
    .set({
      stoppedAt: now,
      durationMinutes,
      stopSource,
    })
    .where(eq(usageSession.id, openSession.id));

  // Update daily usage
  const today = now.toISOString().split("T")[0]!;
  
  // Check if daily usage record exists
  const [existingDailyUsage] = await db
    .select()
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, openSession.userId), eq(dailyUsage.date, today)));

  if (existingDailyUsage) {
    await db
      .update(dailyUsage)
      .set({
        minutesUsed: existingDailyUsage.minutesUsed + durationMinutes,
        updatedAt: now,
      })
      .where(eq(dailyUsage.id, existingDailyUsage.id));
  } else {
    await db.insert(dailyUsage).values({
      userId: openSession.userId,
      date: today,
      minutesUsed: durationMinutes,
    });
  }

  return { durationMinutes };
}

/**
 * Update last active timestamp for a workspace
 */
export async function updateLastActive(workspaceId: string): Promise<void> {
  await db
    .update(workspace)
    .set({
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId));
}

/**
 * Get workspaces that have been idle beyond the timeout
 */
export async function getIdleWorkspaces(): Promise<Array<{ id: string; externalInstanceId: string; userId: string; regionId: string }>> {
  const idleThreshold = new Date(Date.now() - IDLE_TIMEOUT_MINUTES * 60 * 1000);

  const idleWorkspaces = await db
    .select({
      id: workspace.id,
      externalInstanceId: workspace.externalInstanceId,
      userId: workspace.userId,
      regionId: workspace.regionId,
    })
    .from(workspace)
    .where(
      and(
        eq(workspace.status, "running"),
        sql`${workspace.lastActiveAt} < ${idleThreshold}`
      )
    );

  return idleWorkspaces;
}

/**
 * Reset daily usage for all users (called by cron)
 */
export async function resetDailyUsage(): Promise<number> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0]!;

  // We don't actually delete old records (for analytics), 
  // new records are created automatically for the new day
  // This function can be used to clean up very old records if needed
  
  console.log(`Daily usage reset completed for ${yesterdayStr}`);
  return 0;
}


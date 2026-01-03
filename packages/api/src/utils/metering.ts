import { db, eq, and, sql } from "@gitterm/db";
import { dailyUsage, usageSession, workspace, type SessionStopSource } from "@gitterm/db/schema/workspace";
import { logger } from "./logger";
import { shouldEnforceQuota, shouldMeterUsage, getDailyMinuteQuotaAsync } from "../config/features";
import { isSelfHosted } from "../config/deployment";
import { getIdleTimeoutMinutes, getFreeTierDailyMinutes } from "../service/system-config";

// Legacy constants - kept for backwards compatibility but should use getters below
// These are now the DEFAULT values; actual values come from database
export const FREE_TIER_DAILY_MINUTES = 60;
export const IDLE_TIMEOUT_MINUTES = 30;

/**
 * Get the configured idle timeout in minutes (from database)
 */
export async function getConfiguredIdleTimeout(): Promise<number> {
  return getIdleTimeoutMinutes();
}

/**
 * Get the configured free tier daily minutes (from database)
 */
export async function getConfiguredFreeTierMinutes(): Promise<number> {
  return getFreeTierDailyMinutes();
}

/**
 * Get or create daily usage record for a user
 * In self-hosted mode, this still tracks usage but won't enforce limits
 */
export async function getOrCreateDailyUsage(userId: string, userPlan: "free" | "pro" = "free"): Promise<{ minutesUsed: number; minutesRemaining: number }> {
  // In self-hosted mode or for paid plans, return unlimited
  if (isSelfHosted()) {
    return {
      minutesUsed: 0,
      minutesRemaining: Infinity,
    };
  }

  const dailyQuota = await getDailyMinuteQuotaAsync(userPlan);
  
  // Paid plans have unlimited minutes
  if (dailyQuota === Infinity) {
    return {
      minutesUsed: 0,
      minutesRemaining: Infinity,
    };
  }

  const today = new Date().toISOString().split("T")[0]!; // YYYY-MM-DD

  const [existing] = await db
    .select()
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, today)));

  if (existing) {
    return {
      minutesUsed: existing.minutesUsed,
      minutesRemaining: Math.max(0, dailyQuota - existing.minutesUsed),
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
    minutesRemaining: dailyQuota,
  };
}

/**
 * Check if user has remaining daily quota
 * Always returns true in self-hosted mode or when quota enforcement is disabled
 */
export async function hasRemainingQuota(userId: string, userPlan: "free" | "pro" = "free"): Promise<boolean> {
  // Skip quota check if enforcement is disabled
  if (!shouldEnforceQuota()) {
    return true;
  }

  // Paid plans have unlimited quota
  if (userPlan !== "free") {
    return true;
  }

  const usage = await getOrCreateDailyUsage(userId, userPlan);
  if (usage.minutesRemaining <= 0) {
    logger.quotaExhausted(userId);
    return false;
  }
  return true;
}

/**
 * Create a new usage session when workspace starts
 * Skipped if usage metering is disabled
 */
export async function createUsageSession(workspaceId: string, userId: string): Promise<string | null> {
  // Skip if metering is disabled
  if (!shouldMeterUsage()) {
    return null;
  }

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
 * Skipped if usage metering is disabled
 */
export async function closeUsageSession(
  workspaceId: string,
  stopSource: SessionStopSource
): Promise<{ durationMinutes: number }> {
  // Skip if metering is disabled
  if (!shouldMeterUsage()) {
    return { durationMinutes: 0 };
  }

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
    .where(and(eq(dailyUsage.userId, openSession.userId!), eq(dailyUsage.date, today)));

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
 * Uses configurable idle timeout from database
 */
export async function getIdleWorkspaces(): Promise<Array<{ id: string; externalInstanceId: string; userId: string; regionId: string }>> {
  const idleTimeoutMinutes = await getConfiguredIdleTimeout();
  const idleThreshold = new Date(Date.now() - idleTimeoutMinutes * 60 * 1000);

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


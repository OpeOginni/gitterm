import { db, eq, and, sql } from "@gitterm/db";
import {
  dailyUsage,
  usageSession,
  workspace,
  type SessionStopSource,
} from "@gitterm/db/schema/workspace";
import { logger } from "./logger";
import {
  shouldEnforceQuota,
  shouldMeterUsage,
  getDailyMinuteQuotaAsync,
  getIdleTimeoutMinutesForPlan,
  PLAN_LIMITS,
  type UserPlan,
} from "../config/features";
import { isSelfHosted } from "../config/deployment";
import { user } from "@gitterm/db/schema/auth";
import { getIdleTimeoutMinutes, getFreeTierDailyMinutes } from "../service/config/system-config";
import {
  filterIdleWorkspacesByRedisActivityWith,
  recordWorkspaceActivity,
} from "../service/workspace-activity";

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
 * Resolve a user's plan from the database.
 * Falls back to "free" if the user can't be found.
 */
async function resolveUserPlan(userId: string): Promise<UserPlan> {
  const [row] = await db.select({ plan: user.plan }).from(user).where(eq(user.id, userId)).limit(1);
  return (row?.plan ?? "free") as UserPlan;
}

/**
 * Get or create daily usage record for a user
 * In self-hosted mode, this still tracks usage but won't enforce limits.
 *
 * `userPlan` is optional: when omitted it is resolved from the database. Pass it
 * explicitly when you already have the user record to avoid an extra read.
 */
export async function getOrCreateDailyUsage(
  userId: string,
  userPlan?: UserPlan,
): Promise<{ minutesUsed: number; minutesRemaining: number }> {
  // Self-hosted is always unlimited.
  if (isSelfHosted()) {
    return {
      minutesUsed: 0,
      minutesRemaining: Infinity,
    };
  }

  const plan = userPlan ?? (await resolveUserPlan(userId));
  const dailyQuota = await getDailyMinuteQuotaAsync(plan);

  // Defensive: a 0 or unset free-tier config means "unlimited".
  if (dailyQuota === Infinity || dailyQuota === 0) {
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
export async function hasRemainingQuota(userId: string, userPlan?: UserPlan): Promise<boolean> {
  // Skip quota check if enforcement is disabled
  if (!shouldEnforceQuota()) {
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
export async function createUsageSession(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
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
  stopSource: SessionStopSource,
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
    .where(and(eq(usageSession.workspaceId, workspaceId), sql`${usageSession.stoppedAt} IS NULL`));

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
  await recordWorkspaceActivity(workspaceId);
}

/**
 * Get workspaces that have been idle beyond the timeout
 * Uses configurable idle timeout from database
 */
export async function getIdleWorkspaces(): Promise<
  Array<{ id: string; externalInstanceId: string; userId: string; regionId: string | null }>
> {
  const globalIdleTimeoutMinutes = await getConfiguredIdleTimeout();
  const now = Date.now();

  // Pre-filter the DB query with the TIGHTEST (smallest) timeout across all
  // plans so we never miss an aggressively-reaped workspace (e.g. free = 10m).
  // The precise per-plan threshold is then applied in memory below.
  const planTimeouts = (Object.keys(PLAN_LIMITS) as UserPlan[])
    .map((plan) => getIdleTimeoutMinutesForPlan(plan))
    .filter((value): value is number => value !== null);
  const minCandidateMinutes = Math.min(globalIdleTimeoutMinutes, ...planTimeouts);
  const candidateThreshold = new Date(now - minCandidateMinutes * 60 * 1000);

  // Join the owner's plan so we can apply per-plan idle timeouts in managed mode.
  const runningWorkspaces = await db
    .select({
      id: workspace.id,
      externalInstanceId: workspace.externalInstanceId,
      userId: workspace.userId,
      regionId: workspace.regionId,
      lastActiveAt: workspace.lastActiveAt,
      plan: user.plan,
    })
    .from(workspace)
    .leftJoin(user, eq(workspace.userId, user.id))
    .where(
      and(eq(workspace.status, "running"), sql`${workspace.lastActiveAt} < ${candidateThreshold}`),
    );

  // Resolve the precise idle threshold for each workspace's owning plan. In
  // self-hosted mode `getIdleTimeoutMinutesForPlan` returns null, so we fall
  // back to the single global system-config value (plan-agnostic). This same
  // per-workspace threshold is used for the Redis activity cross-check so that
  // fresher Redis activity correctly spares looser-plan workspaces.
  const thresholdFor = (ws: { plan: string | null }): Date => {
    const planTimeout = getIdleTimeoutMinutesForPlan((ws.plan ?? "free") as UserPlan);
    const timeoutMinutes = planTimeout ?? globalIdleTimeoutMinutes;
    return new Date(now - timeoutMinutes * 60 * 1000);
  };

  const filtered = await filterIdleWorkspacesByRedisActivityWith(runningWorkspaces, thresholdFor);
  return filtered.map(
    ({ lastActiveAt: _lastActiveAt, plan: _plan, ...idleWorkspace }) => idleWorkspace,
  );
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

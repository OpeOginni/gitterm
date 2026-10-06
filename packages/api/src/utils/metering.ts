import { db, eq, and, sql } from "@gitterm/db";
import { usageSession, type SessionStopSource } from "@gitterm/db/schema/workspace";
import { shouldMeterUsage } from "../config/features";
import { getIdleTimeoutMinutes } from "../service/config/system-config";

/**
 * Usage metering: records when each cloud workspace runs. Billing derives
 * quotas from these sessions; self-hosted deployments can keep them for
 * visibility (ENABLE_USAGE_METERING).
 */

/**
 * Get the configured idle timeout in minutes (from database)
 */
export async function getConfiguredIdleTimeout(): Promise<number> {
  return getIdleTimeoutMinutes();
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
 * Close a usage session
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

  return { durationMinutes };
}

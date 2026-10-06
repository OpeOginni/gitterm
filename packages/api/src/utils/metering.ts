import { db, and, inArray, isNull, sql } from "@gitterm/db";
import { usageSession, workspace, type SessionStopSource } from "@gitterm/db/schema/workspace";
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
 * Close every open usage session of a workspace. A workspace has at most one,
 * but an orphan left by an earlier path must not keep billing either.
 * Closing is never skipped: it only ends sessions that already exist.
 */
export async function closeUsageSession(
  workspaceId: string,
  stopSource: SessionStopSource,
): Promise<{ durationMinutes: number }> {
  const [closed] = await closeOpenUsageSessions([workspaceId], stopSource);
  return { durationMinutes: closed?.durationMinutes ?? 0 };
}

/** Close the open sessions of these workspaces now; returns what was closed. */
export async function closeOpenUsageSessions(
  workspaceIds: string[],
  stopSource: SessionStopSource,
): Promise<Array<{ workspaceId: string; durationMinutes: number }>> {
  if (workspaceIds.length === 0) return [];
  const now = new Date();
  const closed = await db
    .update(usageSession)
    .set({
      stoppedAt: now,
      durationMinutes: sql`greatest(1, ceil(extract(epoch from (${now.toISOString()}::timestamp - ${usageSession.startedAt})) / 60))::int`,
      stopSource,
    })
    .where(and(inArray(usageSession.workspaceId, workspaceIds), isNull(usageSession.stoppedAt)))
    .returning({
      workspaceId: usageSession.workspaceId,
      durationMinutes: usageSession.durationMinutes,
    });
  return closed.map((row) => ({
    workspaceId: row.workspaceId,
    durationMinutes: row.durationMinutes ?? 0,
  }));
}

/**
 * Close open sessions whose workspace is no longer running, ending them when the
 * workspace stopped. Repairs sessions a status change forgot to close.
 */
export async function closeOrphanedUsageSessions(): Promise<number> {
  const result = await db.execute(sql`
    update ${usageSession} s
    set stopped_at = greatest(s.started_at, least(
          now() at time zone 'utc',
          coalesce(w.terminated_at, w.paused_at, w.updated_at))),
        duration_minutes = greatest(1, ceil(extract(epoch from (greatest(s.started_at, least(
          now() at time zone 'utc',
          coalesce(w.terminated_at, w.paused_at, w.updated_at))) - s.started_at)) / 60))::int,
        stop_source = 'provider_auto'
    from ${workspace} w
    where w.id = s.workspace_id
      and s.stopped_at is null
      and w.status not in ('running', 'pending')`);
  return result.rowCount ?? 0;
}

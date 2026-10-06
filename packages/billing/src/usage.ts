import { and, db, gt, inArray, isNull, lt, or, sql } from "@gitterm/db";
import { usageSession } from "@gitterm/db/schema/workspace";

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Runtime minutes each user has used since midnight UTC, derived from usage
 * sessions. Sessions still running count up to now, and a session crossing
 * midnight only counts its part after midnight.
 */
export async function getMinutesUsedToday(
  userIds: string[],
  now = new Date(),
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const dayStart = startOfUtcDay(now);
  // Timestamps are stored without a time zone as UTC, so bind ISO strings.
  const nowAt = sql`${now.toISOString()}::timestamp`;
  const dayStartAt = sql`${dayStart.toISOString()}::timestamp`;

  const rows = await db
    .select({
      userId: usageSession.userId,
      seconds: sql<string>`sum(extract(epoch from (
        least(coalesce(${usageSession.stoppedAt}, ${nowAt}), ${nowAt})
        - greatest(${usageSession.startedAt}, ${dayStartAt})
      )))`,
    })
    .from(usageSession)
    .where(
      and(
        inArray(usageSession.userId, userIds),
        lt(usageSession.startedAt, now),
        or(isNull(usageSession.stoppedAt), gt(usageSession.stoppedAt, dayStart)),
      ),
    )
    .groupBy(usageSession.userId);

  return new Map(
    rows.flatMap((row) =>
      row.userId ? [[row.userId, Math.ceil(Math.max(0, Number(row.seconds)) / 60)] as const] : [],
    ),
  );
}

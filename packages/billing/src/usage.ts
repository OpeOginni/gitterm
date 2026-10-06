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

/**
 * Retail value of compute consumed: what the customer's usage is worth at
 * our list prices. Not our provider cost, and not cash collected.
 */
export interface RetailUsage {
  /** Retail value this period, in millionths of a dollar. */
  micros: number;
  /** Hourly retail price of the sessions running now, in millionths of a dollar. */
  runningMicrosPerHour: number;
}

/**
 * Retail compute value each user has used since their period start, priced at the machine
 * size's rate in effect when each session started. Running sessions count up
 * to now. Sizes without a price cost nothing.
 */
export async function getRetailUsage(
  periods: Array<{ userId: string; start: Date }>,
  now = new Date(),
): Promise<Map<string, RetailUsage>> {
  if (periods.length === 0) return new Map();
  const nowAt = sql`${now.toISOString()}::timestamp`;
  const result = await db.execute<{
    user_id: string;
    micros: string | null;
    running_micros_per_hour: string | null;
  }>(sql`
    with periods (user_id, period_start) as (
      select * from unnest(
        ${sql.param(periods.map((period) => period.userId))}::text[],
        ${sql.param(periods.map((period) => period.start.toISOString()))}::timestamp[]
      )
    )
    select
      s.user_id,
      sum(
        extract(epoch from (least(coalesce(s.stopped_at, ${nowAt}), ${nowAt}) - greatest(s.started_at, p.period_start)))
        * coalesce(rate.micros_per_hour, 0) / 3600
      ) as micros,
      sum(case when s.stopped_at is null then coalesce(rate.micros_per_hour, 0) else 0 end)
        as running_micros_per_hour
    from usage_session s
    join periods p on p.user_id = s.user_id
    join workspace w on w.id = s.workspace_id
    left join lateral (
      select r.micros_per_hour from billing_machine_rate r
      where r.machine_profile_id = w.machine_profile_id and r.effective_from <= s.started_at
      order by r.effective_from desc
      limit 1
    ) rate on true
    where s.started_at < ${nowAt} and (s.stopped_at is null or s.stopped_at > p.period_start)
    group by s.user_id
  `);

  const costs = new Map<string, RetailUsage>(
    periods.map((period) => [period.userId, { micros: 0, runningMicrosPerHour: 0 }]),
  );
  for (const row of result.rows) {
    costs.set(row.user_id, {
      micros: Math.max(0, Number(row.micros ?? 0)),
      runningMicrosPerHour: Number(row.running_micros_per_hour ?? 0),
    });
  }
  return costs;
}

import { db, sql, type SQL } from "@gitterm/db";

/**
 * When session `s` (joined to its workspace `w`) ends, capped at `now`. An open
 * session only runs while its workspace is live; on a stopped workspace (an
 * orphan nobody closed) it ends when the workspace stopped.
 */
const sessionEnd = (now: SQL) => sql`least(${now}, coalesce(s.stopped_at,
  case when w.status in ('running', 'pending') then ${now}
  else greatest(s.started_at, coalesce(w.terminated_at, w.paused_at, w.updated_at)) end))`;

/** Whether session `s` still accrues: open, on a live workspace. */
const sessionRunning = sql`(s.stopped_at is null and w.status in ('running', 'pending'))`;

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

  const result = await db.execute<{ user_id: string | null; seconds: string | null }>(sql`
    select s.user_id,
      sum(greatest(0, extract(epoch from (${sessionEnd(nowAt)} - greatest(s.started_at, ${dayStartAt}))))) as seconds
    from usage_session s
    join workspace w on w.id = s.workspace_id
    where s.user_id = any(${sql.param(userIds)}::text[])
      and s.started_at < ${nowAt}
      and ${sessionEnd(nowAt)} > ${dayStartAt}
    group by s.user_id`);

  return new Map(
    result.rows.flatMap((row) =>
      row.user_id
        ? [[row.user_id, Math.ceil(Math.max(0, Number(row.seconds ?? 0)) / 60)] as const]
        : [],
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
  /** `end` bounds an ended period; without it usage counts up to now. */
  periods: Array<{ userId: string; start: Date; end?: Date }>,
  now = new Date(),
): Promise<Map<string, RetailUsage>> {
  if (periods.length === 0) return new Map();
  const nowAt = sql`${now.toISOString()}::timestamp`;
  const result = await db.execute<{
    user_id: string;
    micros: string | null;
    running_micros_per_hour: string | null;
  }>(sql`
    with periods (user_id, period_start, period_end) as (
      select * from unnest(
        ${sql.param(periods.map((period) => period.userId))}::text[],
        ${sql.param(periods.map((period) => period.start.toISOString()))}::timestamp[],
        ${sql.param(periods.map((period) => (period.end && period.end < now ? period.end : now).toISOString()))}::timestamp[]
      )
    )
    select
      s.user_id,
      sum(
        greatest(0, extract(epoch from (least(${sessionEnd(nowAt)}, p.period_end) - greatest(s.started_at, p.period_start))))
        * coalesce(rate.micros_per_hour, 0) / 3600
      ) as micros,
      sum(case when ${sessionRunning} and p.period_end = ${nowAt} then coalesce(rate.micros_per_hour, 0) else 0 end)
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
    where s.started_at < p.period_end and ${sessionEnd(nowAt)} > p.period_start
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

import { db, eq, sql } from "@gitterm/db";
import { billingJobState } from "@gitterm/db/schema/billing-analytics";
import { rebuildAccountPeriods } from "./account-periods";
import { purgeProductEvents } from "./product-events";
import { syncSubjects } from "./subjects";
import { syncUsageIntervals } from "./usage-intervals";

const DAY_MS = 86_400_000;
const JOB = "analytics";
/** Open subscription periods can start up to ~a month back; renewal invoices land after. */
const ALWAYS_REBUILD_MS = 40 * DAY_MS;
/** Older changes need an explicit `rebuild` from the CLI. */
const MAX_AUTOMATIC_REBUILD_MS = 400 * DAY_MS;
/** Retention for non-financial product events. */
export const PRODUCT_EVENT_RETENTION_DAYS = Number.parseInt(
  process.env.BILLING_PRODUCT_EVENT_RETENTION_DAYS ?? "730",
  10,
);

async function getWatermark(): Promise<Date | null> {
  const [row] = await db.select().from(billingJobState).where(eq(billingJobState.name, JOB));
  return row?.watermark ?? null;
}

async function setWatermark(watermark: Date): Promise<void> {
  await db
    .insert(billingJobState)
    .values({ name: JOB, watermark, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: billingJobState.name,
      set: { watermark, updatedAt: new Date() },
    });
}

/** Earliest instant whose summaries depend on facts recorded since `watermark`. */
async function earliestAffected(watermark: Date): Promise<Date | null> {
  const at = sql`${watermark.toISOString()}::timestamp`;
  const result = await db.execute<{ earliest: Date | string | null }>(sql`
    select min(earliest) as earliest from (
      select min(started_at) as earliest from billing_usage_interval where updated_at >= ${at}
      union all
      select min(effective_at) from billing_account_event where recorded_at >= ${at}
      union all
      -- A renewal invoice carries the previous period's overage.
      select min(object_created_at) - interval '40 days' from billing_payment_event where received_at >= ${at}
    ) affected
  `);
  const earliest = result.rows[0]?.earliest;
  return earliest ? new Date(earliest) : null;
}

/**
 * The worker's analytics pass: capture usage, rebuild summaries touched by
 * new facts (plus recent periods, which are still open), and purge expired
 * product events. Safe to rerun; each step is idempotent.
 */
export async function runAnalyticsTasks(now = new Date()): Promise<{
  intervals: number;
  periods: number;
  purged: number;
}> {
  const watermark = (await getWatermark()) ?? new Date(now.getTime() - ALWAYS_REBUILD_MS);
  await syncSubjects();
  // Overlap the previous pass so a session that stopped during it isn't missed.
  const intervals = await syncUsageIntervals({
    since: new Date(watermark.getTime() - 60 * 60 * 1000),
    provenance: "observed",
  });

  const affected = await earliestAffected(watermark);
  let from = new Date(now.getTime() - ALWAYS_REBUILD_MS);
  if (affected && affected < from) from = affected;
  const floor = new Date(now.getTime() - MAX_AUTOMATIC_REBUILD_MS);
  if (from < floor) {
    console.warn(
      `[billing] Facts changed before ${floor.toISOString()}; run the analytics rebuild command for that range.`,
    );
    from = floor;
  }
  const { periods } = await rebuildAccountPeriods({ from, cutoff: now });
  const purged = await purgeProductEvents(PRODUCT_EVENT_RETENTION_DAYS);
  await setWatermark(now);
  return { intervals, periods, purged };
}

import { and, db, eq, gt, isNull, lte, sql } from "@gitterm/db";
import { billingOverage } from "@gitterm/db/schema/billing";
import { billableOverageCents } from "./money";
import { reportOverage } from "./polar";
import { getRetailUsage } from "./usage";

/**
 * Pay-as-you-go overage is settled per billing period, independently of the
 * account's current settings: overage earned while pay-as-you-go was on is
 * reported until Polar accepts it, even after pay-as-you-go is turned off or
 * the period ends.
 */

export interface PeriodOverage {
  userId: string;
  period: { start: Date; end: Date };
  payAsYouGo: boolean;
  /** Billable overage so far this period, before the cap. */
  overageCents: number;
  includedCents: number;
  overageDiscountPercent: number;
  spendCapCents: number | null;
}

const capped = (cents: number, capCents: number | null) =>
  capCents === null ? cents : Math.min(cents, capCents);

/**
 * Record this pass's overage for current periods. Only overage accrued while
 * pay-as-you-go is on is earned; turning it off keeps what was earned.
 */
export async function recordPeriodOverage(entries: PeriodOverage[], now = new Date()) {
  for (const entry of entries) {
    if (entry.payAsYouGo && entry.overageCents > 0) {
      const earned = capped(entry.overageCents, entry.spendCapCents);
      await db
        .insert(billingOverage)
        .values({
          userId: entry.userId,
          periodStart: entry.period.start,
          periodEnd: entry.period.end,
          earnedCents: earned,
          includedCents: entry.includedCents,
          overageDiscountPercent: entry.overageDiscountPercent,
          spendCapCents: entry.spendCapCents,
          payAsYouGo: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [billingOverage.userId, billingOverage.periodStart],
          set: {
            earnedCents: sql`greatest(${billingOverage.earnedCents}, ${earned})`,
            periodEnd: entry.period.end,
            includedCents: entry.includedCents,
            overageDiscountPercent: entry.overageDiscountPercent,
            spendCapCents: entry.spendCapCents,
            payAsYouGo: true,
            updatedAt: now,
          },
          setWhere: isNull(billingOverage.closedAt),
        });
    } else if (!entry.payAsYouGo) {
      // Earned overage stays owed; usage from here on is not billable.
      await db
        .update(billingOverage)
        .set({ payAsYouGo: false, updatedAt: now })
        .where(
          and(
            eq(billingOverage.userId, entry.userId),
            eq(billingOverage.periodStart, entry.period.start),
            isNull(billingOverage.closedAt),
          ),
        );
    }
  }
}

/**
 * Count each ended period's final usage once: the last stretch between the
 * previous pass and the period end would otherwise never be reported.
 */
export async function closeEndedPeriods(now = new Date()): Promise<number> {
  const ended = await db
    .select()
    .from(billingOverage)
    .where(and(isNull(billingOverage.closedAt), lte(billingOverage.periodEnd, now)));
  if (ended.length === 0) return 0;
  const usage = await getRetailUsage(
    ended.map((row) => ({ userId: row.userId, start: row.periodStart, end: row.periodEnd })),
    now,
  );
  for (const row of ended) {
    const final = row.payAsYouGo
      ? capped(
          billableOverageCents(
            usage.get(row.userId)?.micros ?? 0,
            row.includedCents,
            row.overageDiscountPercent,
          ),
          row.spendCapCents,
        )
      : 0;
    await db
      .update(billingOverage)
      .set({
        earnedCents: sql`greatest(${billingOverage.earnedCents}, ${final})`,
        closedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(billingOverage.userId, row.userId), eq(billingOverage.periodStart, row.periodStart)),
      );
  }
  return ended.length;
}

/**
 * Report every period whose earned overage Polar hasn't accepted yet, current
 * or ended. Marked reported only after Polar accepts, so failures retry.
 */
export async function reportUnsettledOverage(now = new Date()): Promise<number> {
  const pending = await db
    .select()
    .from(billingOverage)
    .where(gt(billingOverage.earnedCents, billingOverage.reportedCents));
  if (pending.length === 0) return 0;
  const sent = await reportOverage(
    pending.map((row) => ({
      userId: row.userId,
      periodStart: row.periodStart,
      totalCents: row.earnedCents,
      // An ended period's total is dated inside it, so Polar attributes it there.
      timestamp: row.periodEnd <= now ? new Date(row.periodEnd.getTime() - 1000) : now,
    })),
  );
  if (!sent) return 0;
  for (const row of pending) {
    await db
      .update(billingOverage)
      .set({
        reportedCents: sql`greatest(${billingOverage.reportedCents}, ${row.earnedCents})`,
        updatedAt: now,
      })
      .where(
        and(eq(billingOverage.userId, row.userId), eq(billingOverage.periodStart, row.periodStart)),
      );
  }
  return pending.length;
}

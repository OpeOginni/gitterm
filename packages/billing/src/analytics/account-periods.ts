import { and, db, desc, gte, inArray, lt, or, gt, isNull, sql } from "@gitterm/db";
import { getTableColumns } from "drizzle-orm";
import {
  billingAccountEvent,
  billingAccountPeriod,
  billingPaymentEvent,
  billingPlanVersion,
  billingProductEvent,
  billingUsageInterval,
} from "@gitterm/db/schema/billing-analytics";
import { billableOverageCents, MICROS_PER_CENT } from "../money";
import { overlapSeconds, segmentPeriods, type Period } from "./periods";

/**
 * Rebuild `billing_account_period` rows for periods ending after `from`.
 * Deterministic: the same facts and cutoff always produce the same rows, so
 * late payments, refunds, and corrections are picked up by rebuilding the
 * affected range. See docs/billing-analytics.md for definitions.
 */

const DAY_MS = 86_400_000;
/** Look-back so a period that started before `from` is rebuilt whole. */
const SEGMENT_LOOKBACK_MS = 70 * DAY_MS;
/** A renewal invoice carries the previous period's overage; allow it to arrive late. */
const OVERAGE_INVOICE_GRACE_MS = DAY_MS;
const PAID_CATEGORIES = new Set(["paid", "legacy", "trial"]);
const REVENUE_FREE_CATEGORIES = new Set(["free", "admin_assigned", "complimentary"]);
const BATCH = 500;
const CURRENCY = "USD";

type AccountEvent = typeof billingAccountEvent.$inferSelect;
/** An interval with the estimated provider cost rate in effect at its start (null if unknown). */
type Interval = typeof billingUsageInterval.$inferSelect & { costMicrosPerHour: number | null };
type PaymentEvent = typeof billingPaymentEvent.$inferSelect;
type ProductEvent = typeof billingProductEvent.$inferSelect;
type PlanVersion = typeof billingPlanVersion.$inferSelect;
type PeriodRow = typeof billingAccountPeriod.$inferInsert;

interface Facts {
  events: AccountEvent[];
  intervals: Interval[];
  orders: PaymentEvent[];
  productEvents: ProductEvent[];
}

/** The account state in effect at `at`: the latest event effective at or before it. */
function stateAt(events: AccountEvent[], at: Date): AccountEvent | null {
  let state: AccountEvent | null = null;
  for (const event of events) {
    if (event.effectiveAt <= at) state = event;
    else break;
  }
  return state;
}

function periodOutcome(
  events: AccountEvent[],
  period: Period,
  before: AccountEvent | null,
  versions: Map<string, PlanVersion>,
): string {
  const within = (event: AccountEvent, to: Date) =>
    event.effectiveAt >= period.start && event.effectiveAt < to;
  const graceEnd = new Date(period.end.getTime() + DAY_MS);
  if (events.some((event) => event.eventType === "access_revoked" && within(event, graceEnd))) {
    return "revoked";
  }
  const cancelRequests = events.filter((event) => within(event, period.end));
  const lastCancel = cancelRequests
    .filter((event) => event.eventType.startsWith("cancellation_"))
    .at(-1);
  if (lastCancel?.eventType === "cancellation_requested") return "canceled";

  const after = stateAt(events, graceEnd);
  const price = (state: AccountEvent | null) =>
    state?.planVersionId ? (versions.get(state.planVersionId)?.priceCents ?? 0) : 0;
  if (!before || before.plan === "free")
    return after && after.plan !== "free" ? "upgraded" : "none";
  if (price(after) > price(before)) return "upgraded";
  if (price(after) < price(before)) return "downgraded";
  return "renewed";
}

function buildPeriodRows(
  analyticsId: string,
  facts: Facts,
  versions: Map<string, PlanVersion>,
  from: Date,
  cutoff: Date,
): PeriodRow[] {
  const subscriptionPeriods = facts.events
    .filter((event) => event.periodStart && event.periodEnd)
    .map((event) => ({ start: event.periodStart!, end: event.periodEnd! }));
  const unique = [
    ...new Map(subscriptionPeriods.map((period) => [period.start.getTime(), period])).values(),
  ];
  const periods = segmentPeriods(
    unique,
    new Date(from.getTime() - SEGMENT_LOOKBACK_MS),
    cutoff,
  ).filter((period) => period.end > from);

  // Overage invoiced at renewal belongs to the period that just ended.
  const overageByPeriod = new Map<number, number>();
  const usdOrders = facts.orders.filter((order) => order.currency === CURRENCY);
  for (const order of usdOrders) {
    if (order.overageCents == null || order.overageCents === 0) continue;
    if (
      order.billingReason !== "subscription_cycle" &&
      order.billingReason !== "subscription_update"
    )
      continue;
    const target = periods
      .filter(
        (period) =>
          period.end.getTime() <= order.objectCreatedAt.getTime() + OVERAGE_INVOICE_GRACE_MS,
      )
      .at(-1);
    if (target) {
      overageByPeriod.set(
        target.start.getTime(),
        (overageByPeriod.get(target.start.getTime()) ?? 0) + order.overageCents,
      );
    }
  }
  const overageClassified = facts.orders.some((order) => order.overageCents != null);

  const rows: PeriodRow[] = [];
  for (const period of periods) {
    const until = period.end < cutoff ? period.end : cutoff;
    const closed = period.end <= cutoff;
    const warnings: string[] = [];

    // Billing applies the plan held now to the whole current period.
    const state = stateAt(facts.events, new Date(until.getTime() - 1));
    let plan = state?.plan ?? "free";
    let category = state?.commercialCategory ?? "free";
    if (!state) {
      if (facts.events.length > 0) {
        plan = "unknown";
        category = "unknown";
        warnings.push("terms_unknown_before_tracking");
      } else {
        warnings.push("terms_inferred_free");
      }
    }
    const version = state?.planVersionId ? versions.get(state.planVersionId) : undefined;
    const planChangedMidPeriod = facts.events.some(
      (event) =>
        event.eventType === "plan_changed" &&
        event.effectiveAt > period.start &&
        event.effectiveAt < until,
    );

    // Usage: exact seconds inside the period; running sessions count to the cutoff.
    let computeSeconds = 0;
    let alwaysOnSeconds = 0;
    let unpricedSeconds = 0;
    let uncostedSeconds = 0;
    let retailMicros = 0;
    let costMicros = 0;
    for (const interval of facts.intervals) {
      const seconds = overlapSeconds(
        interval.startedAt,
        interval.stoppedAt ?? cutoff,
        period.start,
        until,
      );
      if (seconds <= 0) continue;
      computeSeconds += seconds;
      if (interval.alwaysOn) alwaysOnSeconds += seconds;
      if (interval.retailMicrosPerHour == null) unpricedSeconds += seconds;
      else retailMicros += (seconds * interval.retailMicrosPerHour) / 3600;
      if (interval.costMicrosPerHour == null) uncostedSeconds += seconds;
      else costMicros += (seconds * interval.costMicrosPerHour) / 3600;
    }
    if (unpricedSeconds > 0) warnings.push("unpriced_usage");
    if (uncostedSeconds > 0) warnings.push("cost_unknown");
    else if (computeSeconds > 0) warnings.push("cost_estimated");

    // Revenue: orders created in the period, at their latest observed state.
    const orders = usdOrders.filter(
      (order) => order.objectCreatedAt >= period.start && order.objectCreatedAt < period.end,
    );
    if (
      facts.orders.some(
        (order) =>
          order.currency !== CURRENCY &&
          order.objectCreatedAt >= period.start &&
          order.objectCreatedAt < period.end,
      )
    ) {
      warnings.push("non_usd_revenue_excluded");
    }
    const sum = (values: Array<number | null>) =>
      values.some((value) => value == null) ? null : values.reduce<number>((a, b) => a + b!, 0);
    const invoicedNet = sum(orders.map((order) => order.netCents));
    const collectedNet = sum(orders.map((order) => (order.paid ? order.netCents : 0)));
    const refundedNet = sum(orders.map((order) => order.refundedCents));
    const tax = sum(orders.map((order) => order.taxCents));
    const fees = sum(
      orders.map((order) =>
        !order.paid
          ? 0
          : order.platformFeeCurrency && order.platformFeeCurrency !== CURRENCY
            ? null
            : order.platformFeeCents,
      ),
    );
    if (fees == null) warnings.push("payment_fee_unknown");

    const includedCents = version?.includedComputeCents ?? null;
    const retailCents = retailMicros / MICROS_PER_CENT;
    const payAsYouGo = state?.payAsYouGo ?? false;
    const overageBillable =
      includedCents == null
        ? null
        : payAsYouGo
          ? billableOverageCents(retailMicros, includedCents, version!.overageDiscountPercent)
          : 0;

    const expectsRevenue = PAID_CATEGORIES.has(category);
    if (expectsRevenue && orders.length === 0) warnings.push("revenue_unobserved");
    if (category === "unknown") warnings.push("commercial_category_unknown");
    const revenueComplete =
      (expectsRevenue && orders.length > 0) || REVENUE_FREE_CATEGORIES.has(category);
    const costComplete = uncostedSeconds === 0;
    const contribution =
      revenueComplete && costComplete && collectedNet != null && refundedNet != null && fees != null
        ? Math.round(collectedNet - refundedNet - fees - costMicros / MICROS_PER_CENT)
        : null;

    const inPeriod = (event: ProductEvent) =>
      event.occurredAt >= period.start && event.occurredAt < period.end;
    const periodEvents = facts.productEvents.filter(inPeriod);
    // Free accounts, and periods before tracking began, only get rows when something happened.
    const hasActivity =
      computeSeconds > 0 ||
      orders.length > 0 ||
      periodEvents.length > 0 ||
      (plan !== "free" && plan !== "unknown");
    if (!hasActivity) continue;

    rows.push({
      analyticsId,
      periodStart: period.start,
      periodEnd: period.end,
      periodSource: period.source,
      status: closed ? "closed" : "open",
      planVersionId: version?.id ?? null,
      planId: plan,
      commercialCategory: category,
      planChangedMidPeriod,
      payAsYouGo,
      spendCapCents: payAsYouGo ? (state?.spendCapCents ?? null) : null,
      priceCents: version?.priceCents ?? null,
      includedCents,
      computeSeconds: Math.round(computeSeconds),
      alwaysOnSeconds: Math.round(alwaysOnSeconds),
      unpricedSeconds: Math.round(unpricedSeconds),
      retailUsageMicros: Math.round(retailMicros),
      includedConsumedCents:
        includedCents == null ? null : Math.round(Math.min(retailCents, includedCents)),
      includedUnusedCents:
        includedCents == null ? null : Math.round(Math.max(0, includedCents - retailCents)),
      overageBillableCents: overageBillable,
      invoicedNetCents: invoicedNet,
      invoicedOverageCents: overageClassified
        ? (overageByPeriod.get(period.start.getTime()) ?? 0)
        : null,
      collectedNetCents: collectedNet,
      refundedNetCents: refundedNet,
      taxCents: tax,
      paymentFeeCents: fees,
      costEstimateMicros: Math.round(costMicros),
      uncostedSeconds: Math.round(uncostedSeconds),
      contributionBeforeSharedCents: contribution,
      deniedAttempts: periodEvents.filter((event) => event.eventType === "run_denied").length,
      financialPauses: periodEvents.filter(
        (event) => event.eventType === "workspace_paused_for_spending",
      ).length,
      alertsReached: periodEvents.filter((event) => event.eventType === "alert_threshold_reached")
        .length,
      alertsDelivered: periodEvents.filter(
        (event) => event.eventType === "alert_delivery" && event.outcome === "sent",
      ).length,
      outcome: closed ? periodOutcome(facts.events, period, state, versions) : null,
      warnings,
      rebuiltAt: cutoff,
    });
  }
  return rows;
}

/** Analytics subjects with any fact relevant to periods ending after `from`. */
async function subjectsInScope(windowStart: Date, cutoff: Date): Promise<string[]> {
  const result = await db.execute<{ analytics_id: string }>(sql`
    select analytics_id from billing_account_event where effective_at < ${cutoff.toISOString()}::timestamp
    union
    select analytics_id from billing_usage_interval
      where started_at < ${cutoff.toISOString()}::timestamp
        and (stopped_at is null or stopped_at > ${windowStart.toISOString()}::timestamp)
    union
    select analytics_id from billing_payment_event
      where analytics_id is not null and object_created_at >= ${windowStart.toISOString()}::timestamp
    union
    select analytics_id from billing_product_event
      where occurred_at >= ${windowStart.toISOString()}::timestamp
  `);
  return result.rows.map((row) => row.analytics_id);
}

async function loadFacts(
  analyticsIds: string[],
  windowStart: Date,
  cutoff: Date,
): Promise<Map<string, Facts>> {
  const [events, intervals, orders, productEvents] = await Promise.all([
    db
      .select()
      .from(billingAccountEvent)
      .where(
        and(
          inArray(billingAccountEvent.analyticsId, analyticsIds),
          lt(billingAccountEvent.recordedAt, cutoff),
        ),
      )
      .orderBy(billingAccountEvent.effectiveAt, billingAccountEvent.recordedAt),
    db
      .select({
        ...getTableColumns(billingUsageInterval),
        costMicrosPerHour: sql<number | null>`(
          select rate.micros_per_hour from billing_provider_cost_rate rate
          where rate.machine_profile_id = "billing_usage_interval"."machine_profile_id"
            and rate.effective_from <= "billing_usage_interval"."started_at"
          order by rate.effective_from desc limit 1
        )`,
      })
      .from(billingUsageInterval)
      .where(
        and(
          inArray(billingUsageInterval.analyticsId, analyticsIds),
          lt(billingUsageInterval.startedAt, cutoff),
          or(
            isNull(billingUsageInterval.stoppedAt),
            gt(billingUsageInterval.stoppedAt, windowStart),
          ),
        ),
      ),
    // Latest observed state of each order.
    db
      .selectDistinctOn([billingPaymentEvent.providerObjectId])
      .from(billingPaymentEvent)
      .where(
        and(
          inArray(billingPaymentEvent.analyticsId, analyticsIds),
          sql`${billingPaymentEvent.kind} = 'order'`,
          gte(billingPaymentEvent.objectCreatedAt, windowStart),
          lt(billingPaymentEvent.receivedAt, cutoff),
        ),
      )
      .orderBy(
        billingPaymentEvent.providerObjectId,
        desc(billingPaymentEvent.occurredAt),
        desc(billingPaymentEvent.receivedAt),
      ),
    db
      .select()
      .from(billingProductEvent)
      .where(
        and(
          inArray(billingProductEvent.analyticsId, analyticsIds),
          gte(billingProductEvent.occurredAt, windowStart),
          lt(billingProductEvent.occurredAt, cutoff),
        ),
      ),
  ]);

  const facts = new Map<string, Facts>(
    analyticsIds.map((id) => [id, { events: [], intervals: [], orders: [], productEvents: [] }]),
  );
  for (const event of events) facts.get(event.analyticsId)?.events.push(event);
  for (const interval of intervals) facts.get(interval.analyticsId)?.intervals.push(interval);
  for (const order of orders)
    if (order.analyticsId) facts.get(order.analyticsId)?.orders.push(order);
  for (const event of productEvents) facts.get(event.analyticsId)?.productEvents.push(event);
  return facts;
}

export async function rebuildAccountPeriods(options: {
  from: Date;
  cutoff?: Date;
}): Promise<{ periods: number; subjects: number; cutoff: Date }> {
  const cutoff = options.cutoff ?? new Date();
  const windowStart = new Date(options.from.getTime() - SEGMENT_LOOKBACK_MS);
  const versions = new Map(
    (await db.select().from(billingPlanVersion)).map((version) => [version.id, version]),
  );
  const subjects = await subjectsInScope(windowStart, cutoff);

  const rows: PeriodRow[] = [];
  for (let index = 0; index < subjects.length; index += BATCH) {
    const batch = subjects.slice(index, index + BATCH);
    const facts = await loadFacts(batch, windowStart, cutoff);
    for (const [analyticsId, subjectFacts] of facts) {
      rows.push(...buildPeriodRows(analyticsId, subjectFacts, versions, options.from, cutoff));
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(billingAccountPeriod).where(gt(billingAccountPeriod.periodEnd, options.from));
    for (let index = 0; index < rows.length; index += BATCH) {
      await tx.insert(billingAccountPeriod).values(rows.slice(index, index + BATCH));
    }
  });
  return { periods: rows.length, subjects: subjects.length, cutoff };
}

// Exported for unit tests.
export const __test = { buildPeriodRows, stateAt };

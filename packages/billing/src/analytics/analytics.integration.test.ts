import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, db, eq, sql } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { billingMachineRate } from "@gitterm/db/schema/billing";
import {
  billingAccountEvent,
  billingAccountPeriod,
  billingAnalyticsSubject,
  billingPaymentEvent,
  billingPlanVersion,
  billingUsageInterval,
} from "@gitterm/db/schema/billing-analytics";
import { agentType, cloudProvider, image, machineProfile } from "@gitterm/db/schema/cloud";
import { usageSession, workspace } from "@gitterm/db/schema/workspace";
import { createBilling } from "../index";
import { syncSubscription } from "../auth";
import { PLANS } from "../plans";
import { MICROS_PER_CENT } from "../money";
import { rebuildAccountPeriods } from "./account-periods";
import { recordOrder, type PolarOrderLike } from "./payments";
import { importProviderCosts, providerCostImportSchema } from "./provider-costs";
import { getReport, readOnly } from "./reports";
import { simulatePricing } from "./simulate";
import { syncUsageIntervals } from "./usage-intervals";

// Opt-in: runs only against an explicit, disposable database.
const testUrl = process.env.BILLING_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable BILLING_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;

const HOUR = 3_600_000;
const d = (iso: string) => new Date(iso);
/** Test sizes cost $6/hour retail and $2/hour estimated provider cost. */
const RETAIL_MICROS_PER_HOUR = 6_000_000;
const COST_MICROS_PER_HOUR = 2_000_000;
// A billing period comfortably in the past, so every period here is closed.
const PERIOD = { start: d("2026-01-10T00:00:00Z"), end: d("2026-02-10T00:00:00Z") };
const REBUILD_FROM = d("2025-12-01T00:00:00Z");
const billing = createBilling();

let providerId = "";
let profileId = "";
let imageId = "";
const userIds: string[] = [];

async function createUser(): Promise<string> {
  const id = `analytics-test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name: "Analytics test",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: d("2025-12-15T00:00:00Z"),
    updatedAt: new Date(),
  });
  userIds.push(id);
  return id;
}

async function analyticsIdOf(userId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(billingAnalyticsSubject)
    .where(eq(billingAnalyticsSubject.userId, userId));
  return row!.analyticsId;
}

/** A workspace with one usage session; stoppedAt null means still running. */
async function addSession(userId: string, startedAt: Date, stoppedAt: Date | null) {
  const [created] = await db
    .insert(workspace)
    .values({
      externalInstanceId: "analytics-test",
      userId,
      imageId,
      cloudProviderId: providerId,
      machineProfileId: profileId,
      domain: `${randomUUID()}.example.com`,
      subdomain: randomUUID().slice(0, 12),
      status: stoppedAt ? "paused" : "running",
      startedAt,
      updatedAt: new Date(),
    } as typeof workspace.$inferInsert)
    .returning();
  const [session] = await db
    .insert(usageSession)
    .values({ workspaceId: created!.id, userId, startedAt, stoppedAt })
    .returning();
  return { workspaceId: created!.id, sessionId: session!.id };
}

function subscription(
  userId: string,
  overrides: Partial<{ start: Date; end: Date; productId: string; modifiedAt: Date }> = {},
) {
  return {
    id: `sub-${userId}`,
    status: "active",
    productId: overrides.productId ?? "pro-product",
    currentPeriodStart: overrides.start ?? PERIOD.start,
    currentPeriodEnd: overrides.end ?? PERIOD.end,
    modifiedAt: overrides.modifiedAt ?? overrides.start ?? PERIOD.start,
    customer: { externalId: userId },
  };
}

function order(userId: string, overrides: Partial<PolarOrderLike> = {}): PolarOrderLike {
  return {
    id: `order-${userId}`,
    createdAt: d("2026-01-10T00:05:00Z"),
    modifiedAt: d("2026-01-10T00:05:00Z"),
    status: "paid",
    paid: true,
    subtotalAmount: 2500,
    discountAmount: 0,
    netAmount: 2500,
    taxAmount: 500,
    totalAmount: 3000,
    refundedAmount: 0,
    refundedTaxAmount: 0,
    platformFeeAmount: 175,
    platformFeeCurrency: "usd",
    currency: "usd",
    billingReason: "subscription_create",
    customerId: `cus-${userId}`,
    subscriptionId: `sub-${userId}`,
    customer: { externalId: userId },
    ...overrides,
  };
}

async function periodOf(userId: string) {
  const [row] = await db
    .select()
    .from(billingAccountPeriod)
    .where(
      and(
        eq(billingAccountPeriod.analyticsId, await analyticsIdOf(userId)),
        eq(billingAccountPeriod.periodStart, PERIOD.start),
      ),
    );
  return row;
}

async function rebuild() {
  await syncUsageIntervals({ provenance: "observed" });
  await rebuildAccountPeriods({ from: REBUILD_FROM });
}

describe("billing analytics", () => {
  beforeAll(async () => {
    if (!testUrl) return;
    const suffix = randomUUID();
    const [provider] = await db
      .insert(cloudProvider)
      .values({ name: `analytics-${suffix}`, providerKey: "ascii" })
      .returning();
    providerId = provider!.id;
    const [agent] = await db
      .insert(agentType)
      .values({ key: `analytics-${suffix}`, name: `analytics-${suffix}` })
      .returning();
    const [agentImage] = await db
      .insert(image)
      .values({ name: `analytics-${suffix}`, imageId: "test", agentTypeId: agent!.id })
      .returning();
    imageId = agentImage!.id;
    const [profile] = await db
      .insert(machineProfile)
      .values({
        cloudProviderId: providerId,
        key: "standard",
        name: "Standard",
        vcpus: 4,
        memoryGb: 8,
      })
      .returning();
    profileId = profile!.id;
    await db.insert(billingMachineRate).values({
      machineProfileId: profileId,
      microsPerHour: RETAIL_MICROS_PER_HOUR,
      effectiveFrom: d("2025-01-01T00:00:00Z"),
    });
    await importProviderCosts(
      providerCostImportSchema.parse({
        costRates: [
          {
            machineProfileId: profileId,
            perHour: COST_MICROS_PER_HOUR / 1_000_000,
            currency: "USD",
            effectiveFrom: "2025-01-01T00:00:00Z",
            source: "test estimate",
          },
        ],
      }),
      { dryRun: false },
    );
  });

  afterAll(async () => {
    if (!testUrl) return;
    for (const id of userIds) await db.delete(user).where(eq(user.id, id));
    await db.delete(cloudProvider).where(eq(cloudProvider.id, providerId));
  });

  integration("keeps a period's terms after the plan definition changes", async () => {
    const userId = await createUser();
    await syncSubscription(subscription(userId));
    const [event] = await db
      .select()
      .from(billingAccountEvent)
      .where(eq(billingAccountEvent.analyticsId, await analyticsIdOf(userId)));
    expect(event).toMatchObject({
      eventType: "plan_changed",
      plan: "pro",
      commercialCategory: "paid",
    });
    const original = event!.planVersionId!;

    const included = PLANS.pro.includedComputeCents;
    PLANS.pro.includedComputeCents = 99_999;
    try {
      const other = await createUser();
      await syncSubscription(subscription(other, { start: d("2026-01-11T00:00:00Z") }));
      const [changed] = await db
        .select()
        .from(billingAccountEvent)
        .where(eq(billingAccountEvent.analyticsId, await analyticsIdOf(other)));
      expect(changed!.planVersionId).not.toBe(original);
    } finally {
      PLANS.pro.includedComputeCents = included;
    }

    const [version] = await db
      .select()
      .from(billingPlanVersion)
      .where(eq(billingPlanVersion.id, original));
    expect(version!.includedComputeCents).toBe(included);
    await rebuild();
    expect((await periodOf(userId))!.includedCents).toBe(included);
  });

  integration("ignores webhook replays and out-of-order subscription updates", async () => {
    const userId = await createUser();
    const later = { start: d("2026-02-10T00:00:00Z"), end: d("2026-03-10T00:00:00Z") };
    await syncSubscription(subscription(userId));
    await syncSubscription(subscription(userId)); // replay
    await syncSubscription(subscription(userId, later)); // renewal
    await syncSubscription(subscription(userId)); // delayed earlier delivery
    const events = await db
      .select()
      .from(billingAccountEvent)
      .where(eq(billingAccountEvent.analyticsId, await analyticsIdOf(userId)))
      .orderBy(billingAccountEvent.effectiveAt);
    expect(events.map((event) => event.eventType)).toEqual(["plan_changed", "period_started"]);
    const [account] = await db
      .execute<{ period_start: string }>(
        sql`select period_start from billing_account where user_id = ${userId}`,
      )
      .then((result) => result.rows);
    expect(new Date(account!.period_start).toISOString()).toBe(later.start.toISOString());
  });

  integration("records pay-as-you-go and cap changes with previous values", async () => {
    const userId = await createUser();
    await syncSubscription(subscription(userId));
    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 500 });
    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 2000 });
    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 2000 }); // no change
    const events = await db
      .select()
      .from(billingAccountEvent)
      .where(
        and(
          eq(billingAccountEvent.analyticsId, await analyticsIdOf(userId)),
          eq(billingAccountEvent.eventType, "payg_changed"),
        ),
      )
      .orderBy(billingAccountEvent.recordedAt);
    expect(events.map((event) => [event.previousSpendCapCents, event.spendCapCents])).toEqual([
      [null, 500],
      [500, 2000],
    ]);
    expect(events[0]).toMatchObject({
      previousPayAsYouGo: false,
      payAsYouGo: true,
      source: "customer",
    });
  });

  integration("splits usage across periods and never double-counts a running session", async () => {
    const userId = await createUser();
    // Free account: calendar months. 2 hours in January, 1 in February.
    const started = d("2026-01-31T22:00:00Z");
    const { sessionId } = await addSession(userId, started, null);
    await syncUsageIntervals({ provenance: "observed" });
    await rebuildAccountPeriods({ from: REBUILD_FROM, cutoff: d("2026-02-01T01:00:00Z") });
    await rebuildAccountPeriods({ from: REBUILD_FROM, cutoff: d("2026-02-01T01:00:00Z") });

    await db
      .update(usageSession)
      .set({ stoppedAt: d("2026-02-01T01:00:00Z") })
      .where(eq(usageSession.id, sessionId));
    await rebuild();
    await rebuild();
    const periods = await db
      .select()
      .from(billingAccountPeriod)
      .where(eq(billingAccountPeriod.analyticsId, await analyticsIdOf(userId)))
      .orderBy(billingAccountPeriod.periodStart);
    expect(periods.map((period) => [period.periodSource, period.computeSeconds])).toEqual([
      ["calendar", 2 * 3600],
      ["calendar", 3600],
    ]);
  });

  integration("keeps the rate and machine spec a session started with", async () => {
    const userId = await createUser();
    const { sessionId } = await addSession(
      userId,
      d("2026-01-15T00:00:00Z"),
      d("2026-01-15T01:00:00Z"),
    );
    await syncUsageIntervals({ provenance: "observed" });
    await db.update(machineProfile).set({ vcpus: 16 }).where(eq(machineProfile.id, profileId));
    await billing.setMachinePrice(profileId, 9_000_000);
    await syncUsageIntervals({ provenance: "observed" });
    const [interval] = await db
      .select()
      .from(billingUsageInterval)
      .where(eq(billingUsageInterval.sessionId, sessionId));
    expect(interval).toMatchObject({
      retailMicrosPerHour: RETAIL_MICROS_PER_HOUR,
      machineVcpus: 4,
    });
    await db.update(machineProfile).set({ vcpus: 4 }).where(eq(machineProfile.id, profileId));
    await billing.setMachinePrice(profileId, RETAIL_MICROS_PER_HOUR);
  });

  integration("keeps pseudonymous usage when the user is deleted", async () => {
    const userId = await createUser();
    const { sessionId } = await addSession(
      userId,
      d("2026-01-20T00:00:00Z"),
      d("2026-01-20T02:00:00Z"),
    );
    await syncUsageIntervals({ provenance: "observed" });
    const analyticsId = await analyticsIdOf(userId);
    await billing.onUserDeleted(userId);
    await db.delete(user).where(eq(user.id, userId));

    const [interval] = await db
      .select()
      .from(billingUsageInterval)
      .where(eq(billingUsageInterval.sessionId, sessionId));
    expect(interval!.analyticsId).toBe(analyticsId);
    const mapping = await db
      .select()
      .from(billingAnalyticsSubject)
      .where(eq(billingAnalyticsSubject.analyticsId, analyticsId));
    expect(mapping).toHaveLength(0);
    expect(
      (await db.select().from(usageSession).where(eq(usageSession.id, sessionId))).length,
    ).toBe(0);
  });

  integration(
    "separates paid, admin-assigned, invoiced, collected, refunds, and fees",
    async () => {
      const paid = await createUser();
      await syncSubscription(subscription(paid));
      await addSession(paid, d("2026-01-12T00:00:00Z"), d("2026-01-12T02:00:00Z")); // $12 of retail usage, within the included compute
      await recordOrder(
        order(paid, { status: "pending", paid: false, modifiedAt: d("2026-01-10T00:05:00Z") }),
        "webhook",
        paid,
      );

      // Admin-assigned now, so look at the current (open) calendar period.
      const comp = await createUser();
      await billing.setPlan(comp, "pro");
      await addSession(comp, new Date(Date.now() - 2 * HOUR), new Date(Date.now() - HOUR));

      await rebuild();
      const pending = (await periodOf(paid))!;
      // Included compute is consumed, not extra revenue; nothing collected yet.
      expect(pending).toMatchObject({
        commercialCategory: "paid",
        retailUsageMicros: 12 * 100 * MICROS_PER_CENT,
        includedConsumedCents: 1200,
        overageBillableCents: 0,
        invoicedNetCents: 2500,
        collectedNetCents: 0,
      });

      // Paid later, then partially refunded: replays of the same state are ignored.
      const paidState = order(paid, { modifiedAt: d("2026-01-10T00:06:00Z") });
      await recordOrder(paidState, "webhook", paid);
      await recordOrder(paidState, "webhook", paid);
      const refunded = order(paid, {
        status: "partially_refunded",
        refundedAmount: 500,
        refundedTaxAmount: 100,
        modifiedAt: d("2026-01-20T00:00:00Z"),
      });
      await recordOrder(refunded, "webhook", paid);
      // An older state delivered last doesn't win.
      await recordOrder(
        order(paid, { status: "pending", paid: false, modifiedAt: d("2026-01-10T00:04:00Z") }),
        "webhook",
        paid,
      );
      expect(
        (
          await db
            .select()
            .from(billingPaymentEvent)
            .where(eq(billingPaymentEvent.orderId, `order-${paid}`))
        ).length,
      ).toBe(4);

      await rebuild();
      const settled = (await periodOf(paid))!;
      expect(settled).toMatchObject({
        collectedNetCents: 2500,
        refundedNetCents: 500,
        taxCents: 500,
        paymentFeeCents: 175,
        costEstimateMicros: 2 * COST_MICROS_PER_HOUR,
        // 2500 collected − 500 refunded − 175 fee − 400 estimated cost.
        contributionBeforeSharedCents: 1425,
      });

      const compPeriods = await db
        .select()
        .from(billingAccountPeriod)
        .where(eq(billingAccountPeriod.analyticsId, await analyticsIdOf(comp)));
      // Nothing is invented for the months before the assignment.
      expect(compPeriods).toHaveLength(1);
      const [compPeriod] = compPeriods;
      expect(compPeriod).toMatchObject({
        status: "open",
        commercialCategory: "admin_assigned",
        invoicedNetCents: 0,
      });
      expect(compPeriod!.warnings).not.toContain("revenue_unobserved");
    },
  );

  integration("keeps unknown prices and costs unknown", async () => {
    const userId = await createUser();
    await syncSubscription(subscription(userId));
    const [unpricedProfile] = await db
      .insert(machineProfile)
      .values({
        cloudProviderId: providerId,
        key: `unpriced-${randomUUID().slice(0, 8)}`,
        name: "Unpriced",
      })
      .returning();
    const { workspaceId } = await addSession(
      userId,
      d("2026-01-13T00:00:00Z"),
      d("2026-01-13T01:00:00Z"),
    );
    await db
      .update(workspace)
      .set({ machineProfileId: unpricedProfile!.id })
      .where(eq(workspace.id, workspaceId));
    await recordOrder(order(userId), "webhook", userId);
    await rebuild();
    const period = (await periodOf(userId))!;
    expect(period).toMatchObject({
      unpricedSeconds: 3600,
      uncostedSeconds: 3600,
      retailUsageMicros: 0,
    });
    expect(period.contributionBeforeSharedCents).toBeNull();
    expect(period.warnings).toEqual(expect.arrayContaining(["unpriced_usage", "cost_unknown"]));
  });

  integration("counts paid accounts with no usage", async () => {
    const userId = await createUser();
    await syncSubscription(subscription(userId));
    await rebuild();
    expect((await periodOf(userId))!).toMatchObject({
      computeSeconds: 0,
      includedUnusedCents: PLANS.pro.includedComputeCents,
    });
    const report = await getReport({
      report: "allowance_consumption",
      from: "2026-01-01",
      to: "2026-02-01",
      planIds: ["pro"],
    });
    expect(report.rows.some((row) => Number(row.zero_usage_periods) >= 1)).toBe(true);
    expect(report.reportVersion).toBe(1);
    expect(report.definitions.exhaustion_rate).toBeDefined();
  });

  integration("simulates against the baseline billing rules", async () => {
    const userId = await createUser();
    await syncSubscription(subscription(userId));
    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 10_000 });
    // Fixture: make the pay-as-you-go change effective inside the (past) period.
    await db.execute(sql`
      update billing_account_event set effective_at = ${"2026-01-10T01:00:00.000Z"}::timestamp
      where analytics_id = ${await analyticsIdOf(userId)} and event_type = 'payg_changed'`);
    // 5 hours at $6 = $30: $5 over the included compute.
    await addSession(userId, d("2026-01-14T00:00:00Z"), d("2026-01-14T05:00:00Z"));
    await rebuild();
    expect((await periodOf(userId))!.overageBillableCents).toBe(500);

    const same = await simulatePricing({ from: "2026-01-10", to: "2026-01-11" });
    expect(same.simulated.chargesCents).toBe(same.baseline.chargesCents);
    expect(same.label).toBe("Usage and customer behaviour held constant.");

    const lower = await simulatePricing({
      from: "2026-01-10",
      to: "2026-01-11",
      plans: { pro: { includedComputeCents: 1000 } },
    });
    expect(lower.simulated.chargesCents).toBeGreaterThan(lower.baseline.chargesCents);
    expect(lower.accounts.payingMore).toBeGreaterThanOrEqual(1);
  });

  integration("reports run read-only and keep provider credits separate", async () => {
    await expect(
      readOnly((tx) =>
        tx.execute(sql`insert into billing_job_state (name, watermark) values ('x', now())`),
      ),
    ).rejects.toThrow();

    const providerKey = `test-${randomUUID().slice(0, 8)}`;
    const costs = providerCostImportSchema.parse({
      costs: [
        {
          providerKey,
          sourceRecordId: `inv-${randomUUID()}`,
          scope: "direct",
          category: "compute",
          periodStart: "2026-01-01T00:00:00Z",
          periodEnd: "2026-02-01T00:00:00Z",
          currency: "USD",
          invoiced: 100,
          credits: 100,
          cash: 0,
          status: "invoiced",
        },
      ],
    });
    await importProviderCosts(costs, { dryRun: false });
    await importProviderCosts(costs, { dryRun: false }); // idempotent
    const report = await getReport({
      report: "provider_economics",
      from: "2026-01-01",
      to: "2026-02-01",
      providerKeys: [providerKey],
    });
    const invoiced = report.rows.find(
      (row) => row.section === "provider_costs" && row.status === "invoiced",
    );
    // Credits don't hide the unsubsidised cost.
    expect(invoiced).toMatchObject({
      invoiced_cents: 10_000,
      credits_cents: 10_000,
      cash_cents: 0,
    });
  });
});

import { db, eq, inArray, ne, sql } from "@gitterm/db";
import { billingAccount } from "@gitterm/db/schema/billing";
import { billingAccountEvent } from "@gitterm/db/schema/billing-analytics";
import { ensureSubject } from "./analytics/subjects";
import { currentPlanTerms, ensurePlanVersion } from "./analytics/plan-versions";
import { getFreeDailyMinuteLimit } from "./free-limit";
import { toPlanId, type PlanId } from "./plans";

/** How an account got its plan. An admin-assigned plan is not evidence of payment. */
export type CommercialCategory =
  | "free"
  | "paid"
  | "legacy"
  | "admin_assigned"
  | "complimentary"
  | "trial"
  | "unknown";

export interface Account {
  userId: string;
  plan: PlanId;
  commercialCategory: CommercialCategory;
  subscriptionId: string | null;
  /** Modified time of the last subscription event applied to this account. */
  subscriptionModifiedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  payAsYouGo: boolean;
  spendCapCents: number | null;
  alertsSent: string[];
  alertsPeriodStart: Date | null;
}

const freeAccount = (userId: string): Account => ({
  userId,
  plan: "free",
  commercialCategory: "free",
  subscriptionId: null,
  subscriptionModifiedAt: null,
  periodStart: null,
  periodEnd: null,
  payAsYouGo: false,
  spendCapCents: null,
  alertsSent: [],
  alertsPeriodStart: null,
});

const toAccount = (row: typeof billingAccount.$inferSelect): Account => ({
  userId: row.userId,
  plan: toPlanId(row.plan),
  commercialCategory: row.commercialCategory as CommercialCategory,
  subscriptionId: row.subscriptionId,
  subscriptionModifiedAt: row.subscriptionModifiedAt,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  payAsYouGo: row.payAsYouGo,
  spendCapCents: row.spendCapCents,
  alertsSent: row.alertsSent,
  alertsPeriodStart: row.alertsPeriodStart,
});

export async function getAccounts(userIds: string[]): Promise<Map<string, Account>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(billingAccount)
    .where(inArray(billingAccount.userId, userIds));
  const found = new Map(rows.map((row) => [row.userId, toAccount(row)] as const));
  return new Map(userIds.map((userId) => [userId, found.get(userId) ?? freeAccount(userId)]));
}

export async function getAccount(userId: string): Promise<Account> {
  return (await getAccounts([userId])).get(userId) ?? freeAccount(userId);
}

/** Accounts on any plan but free, for periodic usage reporting. */
export async function listPaidAccounts(): Promise<Account[]> {
  const rows = await db.select().from(billingAccount).where(ne(billingAccount.plan, "free"));
  return rows.map(toAccount);
}

// ============================================================================
// Commercial history
// ============================================================================

export type AccountEventType =
  | "account_snapshot"
  | "plan_changed"
  | "period_started"
  | "payg_changed"
  | "cancellation_requested"
  | "cancellation_withdrawn"
  | "access_revoked";

/** Bump when the meaning of account event fields changes. */
const ACCOUNT_EVENT_SCHEMA_VERSION = 1;

/** Who changed the account, and how to deduplicate the change. */
export interface AccountChangeSource {
  source: "polar_webhook" | "admin" | "customer" | "system" | "backfill";
  actor: "customer" | "admin" | "payment_provider" | "system";
  /** When the change happened at its source (e.g. Polar's modified time). */
  occurredAt?: Date;
  /** Required for replayable sources such as webhooks. */
  idempotencyKey?: string;
  provenance?: "observed" | "reconstructed" | "inferred";
  metadata?: Record<string, string | number | boolean | null>;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertAccountEvent(
  tx: Tx,
  analyticsId: string,
  eventType: AccountEventType,
  before: Account | null,
  after: Account,
  change: AccountChangeSource,
): Promise<void> {
  const now = new Date();
  const terms = currentPlanTerms(
    after.plan,
    after.plan === "free" ? await getFreeDailyMinuteLimit() : null,
  );
  const planVersionId = await ensurePlanVersion(terms);
  await tx
    .insert(billingAccountEvent)
    .values({
      analyticsId,
      eventType,
      schemaVersion: ACCOUNT_EVENT_SCHEMA_VERSION,
      occurredAt: change.occurredAt ?? now,
      effectiveAt: change.occurredAt ?? now,
      recordedAt: now,
      source: change.source,
      actor: change.actor,
      commercialCategory: after.commercialCategory,
      planVersionId,
      previousPlan: before?.plan ?? null,
      plan: after.plan,
      previousPayAsYouGo: before?.payAsYouGo ?? null,
      payAsYouGo: after.payAsYouGo,
      previousSpendCapCents: before?.spendCapCents ?? null,
      spendCapCents: after.spendCapCents,
      periodStart: after.periodStart,
      periodEnd: after.periodEnd,
      subscriptionId: after.subscriptionId,
      provenance: change.provenance ?? "observed",
      idempotencyKey:
        change.idempotencyKey ??
        `${change.source}:${analyticsId}:${eventType}:${now.toISOString()}`,
      metadata: change.metadata ?? null,
    })
    .onConflictDoNothing({ target: billingAccountEvent.idempotencyKey });
}

async function lockAccount(tx: Tx, userId: string): Promise<Account | null> {
  const [row] = await tx
    .select()
    .from(billingAccount)
    .where(eq(billingAccount.userId, userId))
    .for("update");
  return row ? toAccount(row) : null;
}

/** A subscription event, so out-of-order and replayed deliveries can be rejected. */
export interface SubscriptionEvent {
  id: string;
  /** Polar's modified time of the subscription in this event. */
  modifiedAt: Date;
  /** Revocations only apply to the account's current subscription. */
  revocation?: boolean;
}

/**
 * Why a subscription event must not change the account, or null to apply it.
 * Checked on the locked row, so concurrent deliveries can't both pass.
 */
function staleSubscriptionEvent(
  before: Account | null,
  event: SubscriptionEvent,
  periodStart: Date | null,
): string | null {
  if (!before) return event.revocation ? "no current subscription" : null;
  if (before.subscriptionModifiedAt && event.modifiedAt < before.subscriptionModifiedAt) {
    return "older than the last applied event";
  }
  if (event.revocation && before.subscriptionId !== event.id) {
    return "not the current subscription";
  }
  if (
    before.subscriptionId === event.id &&
    before.periodStart &&
    periodStart &&
    periodStart < before.periodStart
  ) {
    return "an earlier billing period";
  }
  return null;
}

/**
 * Change a user's plan and record why. A null period bills by calendar month
 * (e.g. admin-assigned plans). The event type is derived from what changed
 * unless given. Returns false when a subscription event was stale and ignored.
 */
export async function setPlan(
  userId: string,
  plan: PlanId,
  period: { start: Date; end: Date | null } | null,
  change: AccountChangeSource & {
    category: CommercialCategory;
    subscriptionId?: string | null;
    subscription?: SubscriptionEvent;
    eventType?: AccountEventType;
  },
): Promise<boolean> {
  const analyticsId = await ensureSubject(userId);
  return db.transaction(async (tx) => {
    const before = await lockAccount(tx, userId);
    if (change.subscription) {
      const stale = staleSubscriptionEvent(before, change.subscription, period?.start ?? null);
      if (stale) {
        console.warn(`[billing] Ignored subscription event for user=${userId}: ${stale}`);
        return false;
      }
    }
    const now = new Date();
    const values = {
      plan,
      commercialCategory: change.category,
      subscriptionId: change.subscriptionId ?? null,
      // Non-subscription changes keep it, so older subscription events stay rejected.
      subscriptionModifiedAt:
        change.subscription?.modifiedAt ?? before?.subscriptionModifiedAt ?? null,
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
      updatedAt: now,
    };
    const [row] = await tx
      .insert(billingAccount)
      .values({ userId, ...values, createdAt: now })
      .onConflictDoUpdate({ target: billingAccount.userId, set: values })
      .returning();
    const after = toAccount(row!);
    if (!analyticsId) return true;

    const eventType =
      change.eventType ??
      (!before ||
      before.plan !== after.plan ||
      before.commercialCategory !== after.commercialCategory
        ? "plan_changed"
        : before.periodStart?.getTime() !== after.periodStart?.getTime()
          ? "period_started"
          : null);
    if (eventType) await insertAccountEvent(tx, analyticsId, eventType, before, after, change);
    return true;
  });
}

export async function updateSettings(
  userId: string,
  settings: { payAsYouGo: boolean; spendCapCents: number | null },
  change: AccountChangeSource,
): Promise<void> {
  const analyticsId = await ensureSubject(userId);
  await db.transaction(async (tx) => {
    const before = await lockAccount(tx, userId);
    const now = new Date();
    const [row] = await tx
      .insert(billingAccount)
      .values({ userId, plan: "free", ...settings, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: billingAccount.userId, set: { ...settings, updatedAt: now } })
      .returning();
    const after = toAccount(row!);
    const changed =
      before?.payAsYouGo !== after.payAsYouGo || before?.spendCapCents !== after.spendCapCents;
    if (analyticsId && changed) {
      await insertAccountEvent(tx, analyticsId, "payg_changed", before, after, change);
    }
  });
}

/** Record a cancellation request or its withdrawal. Access ends separately, on revocation. */
export async function recordCancellation(
  userId: string,
  eventType: "cancellation_requested" | "cancellation_withdrawn",
  change: AccountChangeSource,
): Promise<void> {
  const analyticsId = await ensureSubject(userId);
  if (!analyticsId) return;
  await db.transaction(async (tx) => {
    const account = (await lockAccount(tx, userId)) ?? freeAccount(userId);
    await insertAccountEvent(tx, analyticsId, eventType, account, account, change);
  });
}

/** Snapshot the current state once, so history has a known starting point. */
export async function recordAccountSnapshot(
  userId: string,
  change: AccountChangeSource,
): Promise<boolean> {
  const analyticsId = await ensureSubject(userId);
  if (!analyticsId) return false;
  const account = await getAccount(userId);
  await db.transaction(async (tx) => {
    await insertAccountEvent(tx, analyticsId, "account_snapshot", null, account, {
      ...change,
      idempotencyKey: change.idempotencyKey ?? `snapshot:${analyticsId}`,
    });
  });
  return true;
}

export async function recordAlerts(
  userId: string,
  periodStart: Date,
  alertsSent: string[],
): Promise<void> {
  await db
    .update(billingAccount)
    .set({ alertsSent, alertsPeriodStart: periodStart, updatedAt: new Date() })
    .where(eq(billingAccount.userId, userId));
}

export async function countUsersByPlan(): Promise<Record<string, number>> {
  const rows = await db
    .select({ plan: billingAccount.plan, count: sql<number>`count(*)` })
    .from(billingAccount)
    .groupBy(billingAccount.plan);
  return Object.fromEntries(rows.map((row) => [row.plan, Number(row.count)]));
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.delete(billingAccount).where(eq(billingAccount.userId, userId));
}

/**
 * The billing period containing `now`: the subscription's period when it is
 * current, otherwise the calendar month (UTC).
 */
export function resolvePeriod(account: Account, now = new Date()): { start: Date; end: Date } {
  if (
    account.periodStart &&
    account.periodEnd &&
    account.periodStart <= now &&
    now < account.periodEnd
  ) {
    return { start: account.periodStart, end: account.periodEnd };
  }
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

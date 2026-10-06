import { db, eq, inArray, ne, sql } from "@gitterm/db";
import { billingAccount } from "@gitterm/db/schema/billing";
import { toPlanId, type PlanId } from "./plans";

export interface Account {
  userId: string;
  plan: PlanId;
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

/** Change a user's plan. A null period bills by calendar month (e.g. admin-assigned plans). */
export async function setPlan(
  userId: string,
  plan: PlanId,
  period: { start: Date; end: Date | null } | null = null,
): Promise<void> {
  const now = new Date();
  const values = {
    plan,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    updatedAt: now,
  };
  await db
    .insert(billingAccount)
    .values({ userId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: billingAccount.userId, set: values });
}

export async function updateSettings(
  userId: string,
  settings: { payAsYouGo: boolean; spendCapCents: number | null },
): Promise<void> {
  const now = new Date();
  await db
    .insert(billingAccount)
    .values({ userId, plan: "free", ...settings, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: billingAccount.userId,
      set: { ...settings, updatedAt: now },
    });
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

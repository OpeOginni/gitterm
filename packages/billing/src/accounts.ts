import { db, eq, inArray, sql } from "@gitterm/db";
import { billingAccount } from "@gitterm/db/schema/billing";
import { toPlanId, type PlanId } from "./plans";

export async function getPlans(userIds: string[]): Promise<Map<string, PlanId>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: billingAccount.userId, plan: billingAccount.plan })
    .from(billingAccount)
    .where(inArray(billingAccount.userId, userIds));
  const plans = new Map(rows.map((row) => [row.userId, toPlanId(row.plan)] as const));
  return new Map(userIds.map((userId) => [userId, plans.get(userId) ?? "free"] as const));
}

export async function getPlan(userId: string): Promise<PlanId> {
  return (await getPlans([userId])).get(userId) ?? "free";
}

export async function setPlan(userId: string, plan: PlanId): Promise<void> {
  const now = new Date();
  await db
    .insert(billingAccount)
    .values({ userId, plan, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: billingAccount.userId, set: { plan, updatedAt: now } });
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

import { db, eq } from "@gitterm/db";
import { systemConfig } from "@gitterm/db/schema/auth";
import type { Billing, Entitlements } from "@gitterm/schema/billing";
import { countUsersByPlan, deleteAccount, getPlan, getPlans, setPlan } from "./accounts";
import { getPlanEntitlements, isPlanId, PLAN_IDS, PLANS, type PlanId } from "./plans";
import { polarClient } from "./polar";
import { getMinutesUsedToday } from "./usage";

/** Free runtime is admin-tunable from the system settings page; 0 means unlimited. */
async function getDailyMinuteLimit(plan: PlanId): Promise<number | null> {
  if (plan !== "free") return PLANS[plan].dailyMinutes;
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "free_tier_daily_minutes"));
  const configured = row ? Number.parseInt(row.value, 10) : PLANS.free.dailyMinutes;
  return Number.isFinite(configured) && configured > 0 ? configured : null;
}

async function getUsersOverAllowance(userIds: string[]): Promise<Set<string>> {
  const [plans, minutesUsed] = await Promise.all([getPlans(userIds), getMinutesUsedToday(userIds)]);
  const limits = new Map<PlanId, number | null>();
  const over = new Set<string>();
  for (const [userId, plan] of plans) {
    if (!limits.has(plan)) limits.set(plan, await getDailyMinuteLimit(plan));
    const limit = limits.get(plan);
    if (limit != null && (minutesUsed.get(userId) ?? 0) >= limit) over.add(userId);
  }
  return over;
}

export function createBilling(): Billing {
  return {
    enabled: true,
    plans: PLAN_IDS,

    async getEntitlements(userId) {
      return getPlanEntitlements(await getPlan(userId));
    },

    async getEntitlementsForUsers(userIds) {
      const plans = await getPlans(userIds);
      return new Map<string, Entitlements>(
        [...plans].map(([userId, plan]) => [userId, getPlanEntitlements(plan)]),
      );
    },

    async checkRunAllowance(userId) {
      if (!(await getUsersOverAllowance([userId])).has(userId)) return { allowed: true };
      const plan = await getPlan(userId);
      return {
        allowed: false,
        reason:
          plan === "pro"
            ? "Daily cloud runtime limit reached. It resets at midnight UTC."
            : "Daily cloud runtime limit reached. It resets at midnight UTC, or upgrade for more runtime.",
      };
    },

    getUsersOverAllowance,

    async getAccount(userId) {
      const plan = await getPlan(userId);
      const [minutesUsed, limit] = await Promise.all([
        getMinutesUsedToday([userId]),
        getDailyMinuteLimit(plan),
      ]);
      return {
        plan,
        planName: PLANS[plan].name,
        dailyMinutes: { used: minutesUsed.get(userId) ?? 0, limit },
      };
    },

    async setPlan(userId, plan) {
      if (!isPlanId(plan)) throw new Error(`Unknown plan "${plan}"`);
      await setPlan(userId, plan);
    },

    countUsersByPlan,

    async onUserDeleted(userId) {
      if (polarClient) {
        try {
          await polarClient.customers.deleteExternal({ externalId: userId });
          console.log(`[polar] Deleted customer for user ${userId}`);
        } catch (error) {
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number((error as { statusCode?: number }).statusCode)
              : undefined;
          if (statusCode !== 404) throw error;
          console.warn(`[polar] No customer found for user ${userId}, skipping delete`);
        }
      }
      await deleteAccount(userId);
    },
  };
}

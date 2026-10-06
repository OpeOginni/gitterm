import type { Entitlements } from "@gitterm/schema/billing";

/**
 * Managed plans. Every plan has finite limits: each running workspace consumes
 * provider compute we pay for.
 */
export const PLAN_IDS = ["free", "starter", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  name: string;
  /** Daily runtime minutes; free reads the admin-tunable system setting instead. */
  dailyMinutes: number;
  entitlements: Omit<Entitlements, "plan">;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    name: "Free",
    dailyMinutes: 60,
    entitlements: {
      providerKeys: ["e2b", "ascii"],
      machineAccess: "smallest",
      maxWorkspaces: 2,
      persistence: false,
      customSubdomain: false,
      idleTimeoutMinutes: 10,
      retentionDays: 2,
    },
  },
  starter: {
    name: "Starter",
    dailyMinutes: 180,
    entitlements: {
      providerKeys: null,
      machineAccess: "any",
      maxWorkspaces: 5,
      persistence: true,
      customSubdomain: true,
      idleTimeoutMinutes: 20,
      retentionDays: 7,
    },
  },
  pro: {
    name: "Pro",
    dailyMinutes: 480,
    entitlements: {
      providerKeys: null,
      machineAccess: "any",
      maxWorkspaces: 15,
      persistence: true,
      customSubdomain: true,
      idleTimeoutMinutes: 30,
      retentionDays: 15,
    },
  },
};

export const isPlanId = (value: string): value is PlanId =>
  (PLAN_IDS as readonly string[]).includes(value);

export const toPlanId = (value: string | null | undefined): PlanId =>
  value && isPlanId(value) ? value : "free";

export const getPlanEntitlements = (plan: PlanId): Entitlements => ({
  plan,
  ...PLANS[plan].entitlements,
});

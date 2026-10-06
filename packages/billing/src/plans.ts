import type { Entitlements } from "@gitterm/schema/billing";

/**
 * Managed plans. Free gets a daily runtime allowance on small machines. Paid
 * plans get a monthly compute balance in dollars, spent at each machine
 * size's hourly price, with optional pay-as-you-go beyond it.
 */
export const PLAN_IDS = ["free", "pro", "growth", "starter"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  name: string;
  priceCents: number;
  /** Free only: daily runtime minutes (the admin-tunable system setting overrides it). */
  dailyMinutes: number | null;
  /** Paid only: compute included each billing period, at list prices. */
  includedComputeCents: number | null;
  /** Discount on overage beyond the included compute. */
  overageDiscountPercent: number;
  entitlements: Omit<Entitlements, "plan">;
}

const paidEntitlements: Omit<Entitlements, "plan"> = {
  providerKeys: null,
  machineAccess: "any",
  maxWorkspaces: 15,
  persistence: true,
  customSubdomain: true,
  alwaysOn: true,
  idleTimeoutMinutes: 30,
  retentionDays: 15,
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    name: "Free",
    priceCents: 0,
    dailyMinutes: 60,
    includedComputeCents: null,
    overageDiscountPercent: 0,
    entitlements: {
      providerKeys: ["e2b", "ascii"],
      machineAccess: "smallest",
      maxWorkspaces: 2,
      persistence: false,
      customSubdomain: false,
      alwaysOn: false,
      idleTimeoutMinutes: 10,
      retentionDays: 2,
    },
  },
  pro: {
    name: "Pro",
    priceCents: 2500,
    dailyMinutes: null,
    includedComputeCents: 2500,
    overageDiscountPercent: 0,
    entitlements: paidEntitlements,
  },
  growth: {
    name: "Growth",
    priceCents: 20000,
    dailyMinutes: null,
    includedComputeCents: 25000,
    overageDiscountPercent: 10,
    entitlements: { ...paidEntitlements, maxWorkspaces: 50, retentionDays: 30 },
  },
  /** Legacy plan; not offered at checkout. */
  starter: {
    name: "Starter",
    priceCents: 1000,
    dailyMinutes: null,
    includedComputeCents: 1000,
    overageDiscountPercent: 0,
    entitlements: { ...paidEntitlements, maxWorkspaces: 5, retentionDays: 7 },
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

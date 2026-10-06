import { createHash } from "node:crypto";
import { db } from "@gitterm/db";
import { billingPlanVersion } from "@gitterm/db/schema/billing-analytics";
import { PLANS, type PlanId } from "../plans";

/** Bump when the shape of recorded terms changes. */
export const TERMS_SCHEMA_VERSION = 1;
export const CURRENCY = "USD";

export interface PlanTerms {
  planId: string;
  name: string;
  currency: string;
  priceCents: number;
  includedComputeCents: number | null;
  overageDiscountPercent: number;
  dailyMinutes: number | null;
  entitlements: Record<string, unknown>;
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value as object)
            .sort()
            .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
        )
      : value;

/** The terms a plan gives today. Free's daily minutes come from the admin setting. */
export function currentPlanTerms(plan: PlanId, freeDailyMinutes: number | null): PlanTerms {
  const definition = PLANS[plan];
  return {
    planId: plan,
    name: definition.name,
    currency: CURRENCY,
    priceCents: definition.priceCents,
    includedComputeCents: definition.includedComputeCents,
    overageDiscountPercent: definition.overageDiscountPercent,
    dailyMinutes: plan === "free" ? freeDailyMinutes : definition.dailyMinutes,
    entitlements: definition.entitlements as unknown as Record<string, unknown>,
  };
}

/** Deterministic id: identical terms always map to the same version. */
export function planVersionId(terms: PlanTerms): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(canonical({ ...terms, termsSchemaVersion: TERMS_SCHEMA_VERSION })))
    .digest("hex")
    .slice(0, 12);
  return `${terms.planId}-${hash}`;
}

/** Store the terms (once) and return their version id. */
export async function ensurePlanVersion(terms: PlanTerms): Promise<string> {
  const id = planVersionId(terms);
  await db
    .insert(billingPlanVersion)
    .values({ id, ...terms, termsSchemaVersion: TERMS_SCHEMA_VERSION })
    .onConflictDoNothing();
  return id;
}

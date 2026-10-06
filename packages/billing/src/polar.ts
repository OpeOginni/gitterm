import { Polar } from "@polar-sh/sdk";
import env, { isBillingEnabled } from "@gitterm/env/auth";
import type { PlanId } from "./plans";

/** Null when no Polar access token is configured (e.g. local managed-mode development). */
export const polarClient = isBillingEnabled()
  ? new Polar({
      accessToken: env.POLAR_ACCESS_TOKEN!,
      server: env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
    })
  : null;

/** Subscription products. Starter is a legacy plan: recognized, but not offered at checkout. */
const products: Array<{ productId: string | undefined; slug: Exclude<PlanId, "free"> }> = [
  { productId: env.POLAR_PRO_PRODUCT_ID, slug: "pro" },
  { productId: env.POLAR_GROWTH_PRODUCT_ID, slug: "growth" },
  { productId: env.POLAR_STARTER_PRODUCT_ID, slug: "starter" },
];

/** Products offered at checkout, with the slug the web app passes. */
export const polarCheckoutProducts = products.flatMap(({ productId, slug }) =>
  productId && slug !== "starter" ? [{ productId, slug }] : [],
);

export const getPlanForProduct = (productId: string): PlanId =>
  products.find((product) => product.productId === productId)?.slug ?? "free";

/**
 * Polar meter event for overage. Each event carries the period's cumulative
 * overage in cents; the meter takes the maximum, so resending is harmless.
 */
export const OVERAGE_EVENT = "compute_overage";

export async function reportOverage(
  reports: Array<{ userId: string; periodStart: Date; totalCents: number }>,
): Promise<void> {
  if (!polarClient || reports.length === 0) return;
  await polarClient.events.ingest({
    events: reports.map((report) => ({
      name: OVERAGE_EVENT,
      externalCustomerId: report.userId,
      externalId: `${report.userId}:${report.periodStart.toISOString()}:${report.totalCents}`,
      metadata: { total_cents: report.totalCents },
    })),
  });
}

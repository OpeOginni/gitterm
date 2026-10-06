import { createPolarCore } from "@polar-sh/sdk/2026-10";
import { deleteExternalCustomers } from "@polar-sh/sdk/2026-10/services/customers";
import { ingestEvents } from "@polar-sh/sdk/2026-10/services/events";
import { iterListOrders } from "@polar-sh/sdk/2026-10/services/orders";
import { iterListRefunds } from "@polar-sh/sdk/2026-10/services/refunds";
import env, { isBillingEnabled } from "@gitterm/env/auth";
import type { PlanId } from "./plans";

/**
 * Polar core client, pinned to API version 2026-10 (Polar's current stable
 * version). The core client has no service properties: import each
 * operation from `@polar-sh/sdk/2026-10/services/*` and pass it the client.
 * Null when no Polar access token is configured (e.g. local managed-mode
 * development).
 */
export const polarClient = isBillingEnabled()
  ? createPolarCore({
      accessToken: env.POLAR_ACCESS_TOKEN!,
      environment: env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
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
  reports: Array<{ userId: string; periodStart: Date; totalCents: number; timestamp?: Date }>,
): Promise<boolean> {
  if (!polarClient || reports.length === 0) return false;
  await ingestEvents(polarClient)({
    events: reports.map((report) => ({
      name: OVERAGE_EVENT,
      external_customer_id: report.userId,
      external_id: `${report.userId}:${report.periodStart.toISOString()}:${report.totalCents}`,
      metadata: { total_cents: report.totalCents },
      ...(report.timestamp ? { timestamp: report.timestamp.toISOString() } : {}),
    })),
  });
  return true;
}

/** Delete the user's Polar customer. Resolves quietly when it doesn't exist. */
export async function deletePolarCustomer(userId: string): Promise<void> {
  if (!polarClient) return;
  try {
    await deleteExternalCustomers(polarClient)(userId);
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

/** Every order and refund in the organization, for the analytics backfill. */
export function listAllOrders() {
  if (!polarClient) throw new Error("Polar is not configured (POLAR_ACCESS_TOKEN)");
  return iterListOrders(polarClient)({ limit: 100 });
}

export function listAllRefunds() {
  if (!polarClient) throw new Error("Polar is not configured (POLAR_ACCESS_TOKEN)");
  return iterListRefunds(polarClient)({ limit: 100 });
}

import { db } from "@gitterm/db";
import { billingPaymentEvent } from "@gitterm/db/schema/billing-analytics";
import type { models } from "@polar-sh/sdk/2026-10";
import { ensureSubject } from "./subjects";

/** Polar orders and refunds (API version 2026-10), as sent in webhooks and returned by the API. */
export type PolarOrder = models.Order;
export type PolarRefund = models.Refund;

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

/** Price ids of metered (overage) prices, so an order's overage can be separated. */
const overagePriceIds = new Set(
  (process.env.POLAR_OVERAGE_PRICE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export function orderOverageCents(order: PolarOrder): number | null {
  if (overagePriceIds.size === 0) return null;
  return order.items
    .filter((item) => item.product_price_id && overagePriceIds.has(item.product_price_id))
    .reduce((sum, item) => sum + item.amount, 0);
}

/**
 * Record one observed state of an order. Replays of the same state are
 * ignored; a newer state adds a row, so earlier states stay auditable.
 */
export async function recordOrder(
  order: PolarOrder,
  source: "webhook" | "api_backfill",
  externalUserId: string | null,
): Promise<void> {
  const analyticsId = externalUserId ? await ensureSubject(externalUserId) : null;
  const occurredAt = toDate(order.modified_at ?? order.created_at);
  await db
    .insert(billingPaymentEvent)
    .values({
      analyticsId,
      provider: "polar",
      providerCustomerId: order.customer_id,
      kind: "order",
      providerObjectId: order.id,
      orderId: order.id,
      subscriptionId: order.subscription_id,
      productId: order.product_id,
      status: order.status,
      billingReason: order.billing_reason,
      currency: order.currency.toUpperCase(),
      subtotalCents: order.subtotal_amount,
      discountCents: order.discount_amount,
      netCents: order.net_amount,
      taxCents: order.tax_amount,
      totalCents: order.total_amount,
      overageCents: orderOverageCents(order),
      refundedCents: order.refunded_amount,
      refundedTaxCents: order.refunded_tax_amount,
      platformFeeCents: order.platform_fee_amount,
      platformFeeCurrency: order.platform_fee_currency?.toUpperCase() ?? null,
      paid: order.paid,
      objectCreatedAt: toDate(order.created_at),
      occurredAt,
      receivedAt: new Date(),
      source,
      idempotencyKey: `polar:order:${order.id}:${order.status}:${order.refunded_amount}:${occurredAt.toISOString()}`,
    })
    .onConflictDoNothing({ target: billingPaymentEvent.idempotencyKey });
}

/** Record one observed state of a refund, including disputes (chargebacks). */
export async function recordRefund(
  refund: PolarRefund,
  source: "webhook" | "api_backfill",
  externalUserId: string | null,
): Promise<void> {
  const analyticsId = externalUserId ? await ensureSubject(externalUserId) : null;
  const occurredAt = toDate(refund.modified_at ?? refund.created_at);
  await db
    .insert(billingPaymentEvent)
    .values({
      analyticsId,
      provider: "polar",
      providerCustomerId: refund.customer_id,
      kind: "refund",
      providerObjectId: refund.id,
      orderId: refund.order_id,
      subscriptionId: refund.subscription_id,
      status: refund.status,
      currency: refund.currency.toUpperCase(),
      // Polar reports refund tax separately, as it does for orders.
      refundedCents: refund.amount,
      refundedTaxCents: refund.tax_amount,
      isDispute: refund.dispute != null,
      objectCreatedAt: toDate(refund.created_at),
      occurredAt,
      receivedAt: new Date(),
      source,
      idempotencyKey: `polar:refund:${refund.id}:${refund.status}:${occurredAt.toISOString()}`,
    })
    .onConflictDoNothing({ target: billingPaymentEvent.idempotencyKey });
}

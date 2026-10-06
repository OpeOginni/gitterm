import { db } from "@gitterm/db";
import { billingPaymentEvent } from "@gitterm/db/schema/billing-analytics";
import { ensureSubject } from "./subjects";

/**
 * The fields of a Polar order or refund this ledger reads. Polar sends them
 * in webhooks and returns them from its API; amounts are in minor units.
 */
export interface PolarOrderLike {
  id: string;
  createdAt: Date | string;
  modifiedAt?: Date | string | null;
  status: string;
  paid?: boolean;
  subtotalAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  refundedAmount: number;
  refundedTaxAmount: number;
  platformFeeAmount?: number | null;
  platformFeeCurrency?: string | null;
  currency: string;
  billingReason: string;
  customerId: string;
  productId?: string | null;
  subscriptionId?: string | null;
  customer?: { externalId?: string | null } | null;
  items?: Array<{ amount: number; productPriceId?: string | null }>;
}

export interface PolarRefundLike {
  id: string;
  createdAt: Date | string;
  modifiedAt?: Date | string | null;
  status: string;
  amount: number;
  taxAmount: number;
  currency: string;
  orderId: string;
  subscriptionId?: string | null;
  customerId: string;
  dispute?: unknown | null;
}

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

/** Price ids of metered (overage) prices, so an order's overage can be separated. */
const overagePriceIds = new Set(
  (process.env.POLAR_OVERAGE_PRICE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export function orderOverageCents(order: PolarOrderLike): number | null {
  if (overagePriceIds.size === 0 || !order.items) return null;
  return order.items
    .filter((item) => item.productPriceId && overagePriceIds.has(item.productPriceId))
    .reduce((sum, item) => sum + item.amount, 0);
}

/**
 * Record one observed state of an order. Replays of the same state are
 * ignored; a newer state adds a row, so earlier states stay auditable.
 */
export async function recordOrder(
  order: PolarOrderLike,
  source: "webhook" | "api_backfill",
  externalUserId: string | null,
): Promise<void> {
  const analyticsId = externalUserId ? await ensureSubject(externalUserId) : null;
  const occurredAt = toDate(order.modifiedAt ?? order.createdAt);
  await db
    .insert(billingPaymentEvent)
    .values({
      analyticsId,
      provider: "polar",
      providerCustomerId: order.customerId,
      kind: "order",
      providerObjectId: order.id,
      orderId: order.id,
      subscriptionId: order.subscriptionId ?? null,
      productId: order.productId ?? null,
      status: order.status,
      billingReason: order.billingReason,
      currency: order.currency.toUpperCase(),
      subtotalCents: order.subtotalAmount,
      discountCents: order.discountAmount,
      netCents: order.netAmount,
      taxCents: order.taxAmount,
      totalCents: order.totalAmount,
      overageCents: orderOverageCents(order),
      refundedCents: order.refundedAmount,
      refundedTaxCents: order.refundedTaxAmount,
      platformFeeCents: order.platformFeeAmount ?? null,
      platformFeeCurrency: order.platformFeeCurrency?.toUpperCase() ?? null,
      paid: order.paid ?? order.status !== "pending",
      objectCreatedAt: toDate(order.createdAt),
      occurredAt,
      receivedAt: new Date(),
      source,
      idempotencyKey: `polar:order:${order.id}:${order.status}:${order.refundedAmount}:${occurredAt.toISOString()}`,
    })
    .onConflictDoNothing({ target: billingPaymentEvent.idempotencyKey });
}

/** Record one observed state of a refund, including disputes (chargebacks). */
export async function recordRefund(
  refund: PolarRefundLike,
  source: "webhook" | "api_backfill",
  externalUserId: string | null,
): Promise<void> {
  const analyticsId = externalUserId ? await ensureSubject(externalUserId) : null;
  const occurredAt = toDate(refund.modifiedAt ?? refund.createdAt);
  await db
    .insert(billingPaymentEvent)
    .values({
      analyticsId,
      provider: "polar",
      providerCustomerId: refund.customerId,
      kind: "refund",
      providerObjectId: refund.id,
      orderId: refund.orderId,
      subscriptionId: refund.subscriptionId ?? null,
      status: refund.status,
      currency: refund.currency.toUpperCase(),
      // Polar reports refund tax separately, as it does for orders.
      refundedCents: refund.amount,
      refundedTaxCents: refund.taxAmount,
      isDispute: refund.dispute != null,
      objectCreatedAt: toDate(refund.createdAt),
      occurredAt,
      receivedAt: new Date(),
      source,
      idempotencyKey: `polar:refund:${refund.id}:${refund.status}:${occurredAt.toISOString()}`,
    })
    .onConflictDoNothing({ target: billingPaymentEvent.idempotencyKey });
}

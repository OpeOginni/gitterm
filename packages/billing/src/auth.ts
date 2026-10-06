import { polar, checkout, portal, webhooks } from "@polar-sh/better-auth";
import type { BetterAuthPlugin } from "better-auth";
import type { models } from "@polar-sh/sdk/2026-10";
import env from "@gitterm/env/auth";
import { recordCancellation, setPlan, type SubscriptionEvent } from "./accounts";
import { recordOrder, recordRefund, type PolarOrder, type PolarRefund } from "./analytics/payments";
import { getPlanForProduct, polarCheckoutProducts, polarClient } from "./polar";

/** Polar subscription (API version 2026-10): snake_case fields, ISO date strings. */
type PolarSubscription = models.Subscription;

/** Idempotency key for a subscription change; replays of the same state share it. */
const subscriptionKey = (kind: string, subscription: PolarSubscription) =>
  `polar:subscription:${subscription.id}:${kind}:${subscription.status}:${subscription.product_id}:${new Date(subscription.current_period_start).toISOString()}:${subscription.modified_at ? new Date(subscription.modified_at).toISOString() : ""}`;

const changedAt = (subscription: PolarSubscription, fallback: Date) =>
  subscription.modified_at ? new Date(subscription.modified_at) : fallback;

/** Identity and order of a subscription event; a new subscription orders by creation. */
const subscriptionEvent = (
  subscription: PolarSubscription,
  revocation = false,
): SubscriptionEvent => ({
  id: subscription.id,
  modifiedAt: new Date(subscription.modified_at ?? subscription.created_at),
  revocation,
});

/** Mirror a subscription's plan and billing period onto the user's billing account. */
export async function syncSubscription(subscription: PolarSubscription): Promise<void> {
  const userId = subscription.customer.external_id;
  if (!userId) {
    console.warn("[polar] Subscription without external_id (userId)");
    return;
  }
  // Revocation downgrades; other statuses (e.g. past_due) keep the plan until then.
  if (subscription.status !== "active" && subscription.status !== "trialing") return;

  const periodStart = new Date(subscription.current_period_start);
  const plan = getPlanForProduct(subscription.product_id);
  console.log(`[polar] Subscription ${subscription.status}: user=${userId}, plan=${plan}`);
  await setPlan(
    userId,
    plan,
    {
      start: periodStart,
      end: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
    },
    {
      source: "polar_webhook",
      actor: "payment_provider",
      category:
        subscription.status === "trialing" ? "trial" : plan === "starter" ? "legacy" : "paid",
      subscriptionId: subscription.id,
      // Replays and late deliveries are rejected inside the account lock.
      subscription: subscriptionEvent(subscription),
      occurredAt: changedAt(subscription, periodStart),
      idempotencyKey: subscriptionKey("sync", subscription),
    },
  );
}

async function syncCancellation(
  subscription: PolarSubscription,
  eventType: "cancellation_requested" | "cancellation_withdrawn",
): Promise<void> {
  const userId = subscription.customer.external_id;
  if (!userId) return;
  await recordCancellation(userId, eventType, {
    source: "polar_webhook",
    actor: "customer",
    occurredAt: changedAt(subscription, new Date()),
    idempotencyKey: subscriptionKey(eventType, subscription),
    // Polar's structured reason only; free-text comments are not collected.
    metadata:
      eventType === "cancellation_requested"
        ? { reason: subscription.customer_cancellation_reason ?? null }
        : undefined,
  });
}

export async function revokeSubscription(subscription: PolarSubscription): Promise<void> {
  const userId = subscription.customer.external_id;
  if (!userId) {
    console.warn("[polar] Subscription revoked but no external_id (userId)");
    return;
  }
  // Access has ended - downgrade to free.
  console.log(`[polar] Subscription revoked: user=${userId} - downgrading to free`);
  await setPlan(userId, "free", null, {
    source: "polar_webhook",
    actor: "payment_provider",
    category: "free",
    eventType: "access_revoked",
    // Only the account's current subscription can take its plan away.
    subscription: subscriptionEvent(subscription, true),
    occurredAt: changedAt(subscription, new Date()),
    idempotencyKey: subscriptionKey("revoked", subscription),
  });
}

const saveOrder = (order: PolarOrder) =>
  recordOrder(order, "webhook", order.customer.external_id ?? null);

// Refunds carry no customer external id; reports link them through their order.
const saveRefund = (refund: PolarRefund) => recordRefund(refund, "webhook", null);

/**
 * Better Auth plugins for Polar checkout, the customer portal, and
 * subscription and payment webhooks. Empty when Polar is not configured.
 *
 * Handlers throw on storage failures so Polar retries; every write is
 * idempotent, so retries and replays are safe. The plugin verifies both
 * Polar's legacy and Standard Webhooks signatures. Polar's `usage()`
 * extension is intentionally not installed: it would let signed-in users
 * ingest their own usage events, and only the server reports usage.
 *
 * Typed as plain plugins so Polar's types never leak into the auth instance.
 */
export function createBillingAuthPlugins(): BetterAuthPlugin[] {
  if (!polarClient) return [];
  return [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          authenticatedUsersOnly: true,
          successUrl: "/checkout/success?checkout_id={CHECKOUT_ID}",
          products: polarCheckoutProducts,
        }),
        portal(),
        ...(env.POLAR_WEBHOOK_SECRET
          ? [
              webhooks({
                secret: env.POLAR_WEBHOOK_SECRET,
                onPayload: async (payload) => {
                  console.log("[polar] Webhook received:", payload.type);
                },
                // Active covers new subscriptions; updated covers renewals and plan changes.
                onSubscriptionActive: (payload) => syncSubscription(payload.data),
                onSubscriptionUpdated: (payload) => syncSubscription(payload.data),
                onSubscriptionCanceled: (payload) =>
                  syncCancellation(payload.data, "cancellation_requested"),
                onSubscriptionUncanceled: (payload) =>
                  syncCancellation(payload.data, "cancellation_withdrawn"),
                onSubscriptionRevoked: (payload) => revokeSubscription(payload.data),
                onOrderCreated: (payload) => saveOrder(payload.data),
                onOrderUpdated: (payload) => saveOrder(payload.data),
                onOrderPaid: (payload) => saveOrder(payload.data),
                onOrderRefunded: (payload) => saveOrder(payload.data),
                onRefundCreated: (payload) => saveRefund(payload.data),
                onRefundUpdated: (payload) => saveRefund(payload.data),
              }),
            ]
          : []),
      ],
    }),
  ];
}

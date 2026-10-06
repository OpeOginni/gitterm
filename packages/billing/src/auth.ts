import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import env from "@gitterm/env/auth";
import { getAccount, recordCancellation, setPlan } from "./accounts";
import {
  recordOrder,
  recordRefund,
  type PolarOrderLike,
  type PolarRefundLike,
} from "./analytics/payments";
import { getPlanForProduct, polarCheckoutProducts, polarClient } from "./polar";

interface SubscriptionData {
  id: string;
  status: string;
  productId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  modifiedAt?: Date | null;
  customerCancellationReason?: string | null;
  customer: { externalId: string | null };
}

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

/** Idempotency key for a subscription change; replays of the same state share it. */
const subscriptionKey = (kind: string, subscription: SubscriptionData) =>
  `polar:subscription:${subscription.id}:${kind}:${subscription.status}:${subscription.productId}:${toDate(subscription.currentPeriodStart).toISOString()}:${subscription.modifiedAt ? toDate(subscription.modifiedAt).toISOString() : ""}`;

/** Mirror a subscription's plan and billing period onto the user's billing account. */
export async function syncSubscription(subscription: SubscriptionData): Promise<void> {
  const userId = subscription.customer.externalId;
  if (!userId) {
    console.warn("[polar] Subscription without externalId (userId)");
    return;
  }
  // Revocation downgrades; other statuses (e.g. past_due) keep the plan until then.
  if (subscription.status !== "active" && subscription.status !== "trialing") return;

  const periodStart = toDate(subscription.currentPeriodStart);
  // A delayed delivery of an earlier period must not roll the account back.
  const current = await getAccount(userId);
  if (
    current.subscriptionId === subscription.id &&
    current.periodStart &&
    periodStart < current.periodStart
  ) {
    console.warn(`[polar] Ignoring out-of-order subscription update for user=${userId}`);
    return;
  }

  const plan = getPlanForProduct(subscription.productId);
  console.log(`[polar] Subscription ${subscription.status}: user=${userId}, plan=${plan}`);
  await setPlan(
    userId,
    plan,
    {
      start: periodStart,
      end: subscription.currentPeriodEnd ? toDate(subscription.currentPeriodEnd) : null,
    },
    {
      source: "polar_webhook",
      actor: "payment_provider",
      category:
        subscription.status === "trialing" ? "trial" : plan === "starter" ? "legacy" : "paid",
      subscriptionId: subscription.id,
      occurredAt: subscription.modifiedAt ? toDate(subscription.modifiedAt) : periodStart,
      idempotencyKey: subscriptionKey("sync", subscription),
    },
  );
}

async function syncCancellation(
  subscription: SubscriptionData,
  eventType: "cancellation_requested" | "cancellation_withdrawn",
): Promise<void> {
  const userId = subscription.customer.externalId;
  if (!userId) return;
  await recordCancellation(userId, eventType, {
    source: "polar_webhook",
    actor: "customer",
    occurredAt: subscription.modifiedAt ? toDate(subscription.modifiedAt) : new Date(),
    idempotencyKey: subscriptionKey(eventType, subscription),
    // Polar's structured reason only; free-text comments are not collected.
    metadata:
      eventType === "cancellation_requested"
        ? { reason: subscription.customerCancellationReason ?? null }
        : undefined,
  });
}

/**
 * Better Auth plugins for Polar checkout, the customer portal, and
 * subscription and payment webhooks. Empty when Polar is not configured.
 * Handlers throw on storage failures so Polar retries; every write is
 * idempotent, so retries and replays are safe.
 */
export function createBillingAuthPlugins() {
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
        usage(),
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
                onSubscriptionRevoked: async (payload) => {
                  const subscription = payload.data as SubscriptionData;
                  const userId = subscription.customer.externalId;
                  if (!userId) {
                    console.warn("[polar] Subscription revoked but no externalId (userId)");
                    return;
                  }
                  // Access has ended - downgrade to free.
                  console.log(`[polar] Subscription revoked: user=${userId} - downgrading to free`);
                  await setPlan(userId, "free", null, {
                    source: "polar_webhook",
                    actor: "payment_provider",
                    category: "free",
                    eventType: "access_revoked",
                    occurredAt: subscription.modifiedAt
                      ? toDate(subscription.modifiedAt)
                      : new Date(),
                    idempotencyKey: subscriptionKey("revoked", subscription),
                  });
                },
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
    }) as any, // better-auth peer dependency version mismatch
  ];
}

async function saveOrder(data: unknown): Promise<void> {
  const order = data as PolarOrderLike;
  await recordOrder(order, "webhook", order.customer?.externalId ?? null);
}

async function saveRefund(data: unknown): Promise<void> {
  const refund = data as PolarRefundLike & { customer?: { externalId?: string | null } };
  await recordRefund(refund, "webhook", refund.customer?.externalId ?? null);
}

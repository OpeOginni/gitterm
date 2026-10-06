import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import env from "@gitterm/env/auth";
import { setPlan } from "./accounts";
import { getPlanForProduct, polarCheckoutProducts, polarClient } from "./polar";

interface SubscriptionData {
  status: string;
  productId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  customer: { externalId: string | null };
}

/** Mirror a subscription's plan and billing period onto the user's billing account. */
async function syncSubscription(subscription: SubscriptionData): Promise<void> {
  const userId = subscription.customer.externalId;
  if (!userId) {
    console.warn("[polar] Subscription without externalId (userId)");
    return;
  }
  // Revocation downgrades; other statuses (e.g. past_due) keep the plan until then.
  if (subscription.status !== "active" && subscription.status !== "trialing") return;
  const plan = getPlanForProduct(subscription.productId);
  console.log(`[polar] Subscription ${subscription.status}: user=${userId}, plan=${plan}`);
  await setPlan(userId, plan, {
    start: new Date(subscription.currentPeriodStart),
    end: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
  });
}

/**
 * Better Auth plugins for Polar checkout, the customer portal, and
 * subscription webhooks. Empty when Polar is not configured.
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
                onSubscriptionRevoked: async (payload) => {
                  const userId = payload.data.customer.externalId;
                  if (!userId) {
                    console.warn("[polar] Subscription revoked but no externalId (userId)");
                    return;
                  }
                  // Access has ended - downgrade to free.
                  console.log(`[polar] Subscription revoked: user=${userId} - downgrading to free`);
                  await setPlan(userId, "free", null);
                },
              }),
            ]
          : []),
      ],
    }) as any, // better-auth peer dependency version mismatch
  ];
}

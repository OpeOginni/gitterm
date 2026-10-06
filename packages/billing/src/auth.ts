import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import env from "@gitterm/env/auth";
import { setPlan } from "./accounts";
import { getPlanForProduct, polarClient, polarProducts } from "./polar";

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
          products: polarProducts,
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
                onSubscriptionActive: async (payload) => {
                  const userId = payload.data.customer.externalId;
                  if (!userId) {
                    console.warn("[polar] Subscription active but no externalId (userId)");
                    return;
                  }
                  const plan = getPlanForProduct(payload.data.productId);
                  console.log(
                    `[polar] Subscription active: user=${userId}, product=${payload.data.productId}, plan=${plan}`,
                  );
                  await setPlan(userId, plan);
                },
                onSubscriptionRevoked: async (payload) => {
                  const userId = payload.data.customer.externalId;
                  if (!userId) {
                    console.warn("[polar] Subscription revoked but no externalId (userId)");
                    return;
                  }
                  // Access has ended - downgrade to free.
                  console.log(`[polar] Subscription revoked: user=${userId} - downgrading to free`);
                  await setPlan(userId, "free");
                },
              }),
            ]
          : []),
      ],
    }) as any, // better-auth peer dependency version mismatch
  ];
}

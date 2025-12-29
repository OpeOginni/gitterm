import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@gitterm/db";
import * as schema from "@gitterm/db/schema/auth";
import { nextCookies } from "better-auth/next-js";
import { Polar } from "@polar-sh/sdk";
import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import { eq } from "drizzle-orm";
import env, { isProduction, isBillingEnabled as checkBillingEnabled, isGitHubAuthEnabled, isSubdomainRouting } from "@gitterm/env/auth";

// ============================================================================
// Environment Configuration
// ============================================================================

const SUBDOMAIN_DOMAIN = `.${env.BASE_DOMAIN}`;
const AUTH_BASE_PATH = "/api/auth";

function inferBaseUrlOrigin(): string {
  // If explicitly configured, trust it (but normalize to origin so better-auth can append basePath cleanly)
  if (env.BETTER_AUTH_URL) {
    try {
      return new URL(env.BETTER_AUTH_URL).origin;
    } catch {
      // fall through to BASE_DOMAIN-based inference
    }
  }

  // Derive from BASE_DOMAIN (supports localhost:8888 in local dev)
  const isLocal =
    env.BASE_DOMAIN.includes("localhost") || env.BASE_DOMAIN.includes("127.0.0.1");
  return `${isLocal ? "http" : "https"}://${env.BASE_DOMAIN}`;
}

// ============================================================================
// Plan Types and Product Mapping
// ============================================================================

type UserPlan = "free" | "tunnel" | "pro";

/**
 * Maps Polar product IDs to plan names
 */
const PRODUCT_TO_PLAN: Record<string, UserPlan> = {
  ...(env.POLAR_TUNNEL_PRODUCT_ID
    ? { [env.POLAR_TUNNEL_PRODUCT_ID]: "tunnel" as const }
    : {}),
  ...(env.POLAR_PRO_PRODUCT_ID
    ? { [env.POLAR_PRO_PRODUCT_ID]: "pro" as const }
    : {})
};

/**
 * Get plan from product ID
 */
const getPlanFromProductId = (productId: string): UserPlan => {
  return PRODUCT_TO_PLAN[productId] ?? "free";
};

// ============================================================================
// Polar Client (only if billing is enabled)
// ============================================================================

const polarClient = checkBillingEnabled()
  ? new Polar({
      accessToken: env.POLAR_ACCESS_TOKEN!,
      server: env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
    })
  : null;

// Product configurations for checkout
const POLAR_PRODUCTS = [
  ...(env.POLAR_TUNNEL_PRODUCT_ID
    ? [{ productId: env.POLAR_TUNNEL_PRODUCT_ID, slug: "tunnel" as const }]
    : []),
  ...(env.POLAR_PRO_PRODUCT_ID
    ? [{ productId: env.POLAR_PRO_PRODUCT_ID, slug: "pro" as const }]
    : [])
];

// ============================================================================
// Database Helpers for Plan Updates
// ============================================================================

/**
 * Update user's plan in the database
 */
const updateUserPlan = async (userId: string, plan: UserPlan): Promise<void> => {
  try {
    await db
      .update(schema.user)
      .set({
        plan,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));

    console.log(`[polar] Updated user ${userId} to plan: ${plan}`);
  } catch (error) {
    console.error(`[polar] Failed to update user ${userId} plan:`, error);
    throw error;
  }
};

// ============================================================================
// Better Auth Configuration
// ============================================================================

export const auth = betterAuth({
  // IMPORTANT:
  // Ensure better-auth's internal router basePath is stable and not accidentally
  // derived from env.BASE_URL (which might include "/api" in local dev).
  baseURL: inferBaseUrlOrigin(),
  basePath: AUTH_BASE_PATH,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  trustedOrigins: env.CORS_ORIGIN ? [env.CORS_ORIGIN] : undefined,
  // Cross-subdomain cookies only needed for subdomain routing (*.gitterm.dev)
  // Path routing (Railway unified / self-hosted) uses standard same-origin cookies
  crossSubDomainCookies: isProduction() && isSubdomainRouting()
    ? { enabled: true, domain: SUBDOMAIN_DOMAIN }
    : undefined,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: isGitHubAuthEnabled()
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID!,
          clientSecret: env.GITHUB_CLIENT_SECRET!,
        },
      }
    : undefined,
  user: {
    additionalFields: {
      plan: {
        type: ["free", "tunnel", "pro", "enterprise"],
        required: false,
        defaultValue: "free",
        input: false, // don't allow user to set plan
      },
      role: {
        type: ["user", "admin"],
        required: false,
        defaultValue: "user",
        input: false, // don't allow user to set role
      }
    }
  },
  advanced: {
    defaultCookieAttributes: isProduction()
      ? isSubdomainRouting()
        ? {
            // Subdomain routing: cross-subdomain cookies for *.gitterm.dev
            secure: true,
            httpOnly: true,
            sameSite: "none",
            partitioned: true,
            domain: SUBDOMAIN_DOMAIN,
          }
        : {
            // Path routing: standard same-origin cookies (Railway unified / self-hosted)
            secure: true,
            httpOnly: true,
            sameSite: "lax",
          }
      : {
          // Development
          sameSite: "lax",
          secure: false,
          httpOnly: true,
        },
  },
  plugins: [
    // Polar billing plugin (only if enabled)
    ...(polarClient
      ? [
          polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            use: [
              checkout({
                authenticatedUsersOnly: true,
                successUrl: "/dashboard?checkout=success&checkout_id={CHECKOUT_ID}",
                products: POLAR_PRODUCTS,
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
                        const productId = payload.data.productId;

                        if (!userId) {
                          console.warn("[polar] Subscription active but no externalId (userId)");
                          return;
                        }

                        const plan = getPlanFromProductId(productId);
                        console.log(`[polar] Subscription active: user=${userId}, product=${productId}, plan=${plan}`);

                        await updateUserPlan(userId, plan);
                      },
                      onSubscriptionCanceled: async (payload) => {
                        const userId = payload.data.customer.externalId;

                        if (!userId) {
                          console.warn("[polar] Subscription canceled but no externalId (userId)");
                          return;
                        }

                        console.log(`[polar] Subscription canceled: user=${userId}`);
                        await updateUserPlan(userId, "free");
                      },
                      onSubscriptionRevoked: async (payload) => {
                        const userId = payload.data.customer.externalId;

                        if (!userId) {
                          console.warn("[polar] Subscription revoked but no externalId (userId)");
                          return;
                        }

                        console.log(`[polar] Subscription revoked: user=${userId}`);
                        await updateUserPlan(userId, "free");
                      },
                    }),
                  ]
                : []),
            ],
          }) as any, // Type cast needed due to better-auth peer dependency version mismatch
        ]
      : []),
    // nextCookies must be last
    nextCookies(),
  ],
});

// ============================================================================
// Exports
// ============================================================================

export { polarClient };
export const isBillingEnabled = polarClient !== null;
export const availableProducts = POLAR_PRODUCTS;
export type { UserPlan };

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@gitterm/db";
import * as schema from "@gitterm/db/schema/auth";
import * as agentLoopSchema from "@gitterm/db/schema/agent-loop";
import { nextCookies } from "better-auth/next-js";
import { Polar } from "@polar-sh/sdk";
import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import { eq } from "drizzle-orm";
import env, {
  isProduction,
  isBillingEnabled as checkBillingEnabled,
  isGitHubAuthEnabled,
} from "@gitterm/env/auth";
import { addMonths } from "date-fns";

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
  const isLocal = env.BASE_DOMAIN.includes("localhost") || env.BASE_DOMAIN.includes("127.0.0.1");
  return `${isLocal ? "http" : "https"}://${env.BASE_DOMAIN}`;
}

// ============================================================================
// Plan Types and Product Mapping
// ============================================================================

type UserPlan = "free"| "pro";

/**
 * Maps Polar product IDs to plan names (for subscriptions)
 */
const PRODUCT_TO_PLAN: Record<string, UserPlan> = {
  ...(env.POLAR_PRO_PRODUCT_ID ? { [env.POLAR_PRO_PRODUCT_ID]: "pro" as const } : {}),
};

/**
 * Maps Polar product IDs to run pack names (for one-time purchases)
 */
const PRODUCT_TO_PLAN_RUN_PACK: Record<string, "run_pack_50" | "run_pack_100" | null> = {
  ...(env.POLAR_RUN_PACK_50_PRODUCT_ID
    ? { [env.POLAR_RUN_PACK_50_PRODUCT_ID]: "run_pack_50" as const }
    : {}),
  ...(env.POLAR_RUN_PACK_100_PRODUCT_ID
    ? { [env.POLAR_RUN_PACK_100_PRODUCT_ID]: "run_pack_100" as const }
    : {}),
};

const RUN_PACK_TO_RUNS_MAP: Record<"run_pack_50" | "run_pack_100", number> = {
  run_pack_50: 50,
  run_pack_100: 100,
};

const MONTHLY_RUN_QUOTAS: Record<UserPlan, number> = {
  free: 10,
  pro: 100,
};

/**
 * Get plan from product ID
 */
const getPlanFromProductId = (productId: string): UserPlan => {
  return PRODUCT_TO_PLAN[productId] ?? "free";
};

const getRunPackFromProductId = (productId: string): "run_pack_50" | "run_pack_100" | null => {
  return PRODUCT_TO_PLAN_RUN_PACK[productId] ?? null;
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

// Product configurations for checkout (subscriptions and one-time purchases)
const POLAR_PRODUCTS = [
  ...(env.POLAR_PRO_PRODUCT_ID
    ? [{ productId: env.POLAR_PRO_PRODUCT_ID, slug: "pro" as const }]
    : []),
  ...(env.POLAR_RUN_PACK_50_PRODUCT_ID
    ? [{ productId: env.POLAR_RUN_PACK_50_PRODUCT_ID, slug: "run_pack_50" as const }]
    : []),
  ...(env.POLAR_RUN_PACK_100_PRODUCT_ID
    ? [{ productId: env.POLAR_RUN_PACK_100_PRODUCT_ID, slug: "run_pack_100" as const }]
    : []),
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

const recordUserLoopRunEvent = async (
  userId: string,
  runsAdded: number,
  refund: boolean = false,
): Promise<void> => {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(agentLoopSchema.userLoopRunEvent).values({
        userId,
        runsAdded: runsAdded,
      });

      const [userCurrentRunPlan] = await tx
        .select()
        .from(agentLoopSchema.userLoopRunQuota)
        .where(eq(agentLoopSchema.userLoopRunQuota.userId, userId));

      if (!userCurrentRunPlan) {
        if (refund) {
          return;
        }

        const [user] = await tx.select().from(schema.user).where(eq(schema.user.id, userId));

        if (!user) {
          throw new Error("User not found");
        }

        await tx.insert(agentLoopSchema.userLoopRunQuota).values({
          userId,
          plan: user.plan,
          monthlyRuns: MONTHLY_RUN_QUOTAS[user.plan as UserPlan],
          extraRuns: runsAdded,
          nextMonthlyResetAt: addMonths(new Date(), 1),
        });

        await tx
          .update(agentLoopSchema.userLoopRunQuota)
          .set({
            extraRuns: runsAdded,
          })
          .where(eq(agentLoopSchema.userLoopRunQuota.userId, userId));

        return;
      }

      const newExtraRunsRaw = refund
        ? userCurrentRunPlan.extraRuns - runsAdded
        : userCurrentRunPlan.extraRuns + runsAdded;
      const newExtraRuns = Math.max(newExtraRunsRaw, 0);

      await tx
        .update(agentLoopSchema.userLoopRunQuota)
        .set({
          extraRuns: newExtraRuns,
        })
        .where(eq(agentLoopSchema.userLoopRunQuota.userId, userId));
    });
  } catch (error) {
    console.error(`[polar] Failed to update user ${userId} run plan:`, error);
    throw error;
  }
};

const createUserLoopRunQuota = async (userId: string, plan: UserPlan): Promise<void> => {
  try {
    await db.insert(agentLoopSchema.userLoopRunQuota).values({
      userId,
      plan: plan,
      monthlyRuns: MONTHLY_RUN_QUOTAS[plan],
      extraRuns: 0,
      nextMonthlyResetAt: addMonths(new Date(), 1),
    });
  } catch (error) {
    console.error(`[polar] Failed to create user ${userId} run quota:`, error);
    throw error;
  }
};

const updateUserLoopRunQuota = async (
  userId: string,
  plan: UserPlan,
  billingPeriodEnd: Date,
): Promise<void> => {
  try {
    // Check if quota exists
    const [existingQuota] = await db
      .select()
      .from(agentLoopSchema.userLoopRunQuota)
      .where(eq(agentLoopSchema.userLoopRunQuota.userId, userId));

    if (existingQuota) {
      // Update existing quota
      await db
        .update(agentLoopSchema.userLoopRunQuota)
        .set({
          plan: plan,
          monthlyRuns: MONTHLY_RUN_QUOTAS[plan],
          nextMonthlyResetAt: billingPeriodEnd,
          updatedAt: new Date(),
        })
        .where(eq(agentLoopSchema.userLoopRunQuota.userId, userId));
    } else {
      // Create new quota for existing user
      await db.insert(agentLoopSchema.userLoopRunQuota).values({
        userId,
        plan: plan,
        monthlyRuns: MONTHLY_RUN_QUOTAS[plan],
        extraRuns: 0,
        nextMonthlyResetAt: billingPeriodEnd,
      });
    }
  } catch (error) {
    console.error(`[polar] Failed to update user ${userId} run quota monthly:`, error);
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
  crossSubDomainCookies: isProduction() ? { enabled: true, domain: SUBDOMAIN_DOMAIN } : undefined,
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
        type: ["free", "pro"],
        required: false,
        defaultValue: "free",
        input: false, // don't allow user to set plan
      },
      role: {
        type: ["user", "admin"],
        required: false,
        defaultValue: "user",
        input: false, // don't allow user to set role
      },
    },
  },
  advanced: {
    defaultCookieAttributes: isProduction()
      ? {
          secure: true,
          httpOnly: true,
          sameSite: "none",
          partitioned: true,
          domain: SUBDOMAIN_DOMAIN,
        }
      : {
          sameSite: "lax",
          secure: false,
          httpOnly: true,
        },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          await createUserLoopRunQuota(user.id, "free");
        },
      },
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
                successUrl: "/checkout/success?checkout_id={CHECKOUT_ID}",
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
                        console.log(
                          `[polar] Subscription active: user=${userId}, product=${productId}, plan=${plan}`,
                        );

                        await updateUserPlan(userId, plan);

                        if (plan === "pro") {
                          const billingEnd = payload.data.currentPeriodEnd
                            ? new Date(payload.data.currentPeriodEnd)
                            : addMonths(new Date(), 1);
                          await updateUserLoopRunQuota(userId, plan, billingEnd);
                        }
                      },
                      onSubscriptionCanceled: async (payload) => {
                        const userId = payload.data.customer.externalId;

                        if (!userId) {
                          console.warn("[polar] Subscription canceled but no externalId (userId)");
                          return;
                        }
                      },
                      onSubscriptionRevoked: async (payload) => {
                        const userId = payload.data.customer.externalId;

                        if (!userId) {
                          console.warn("[polar] Subscription revoked but no externalId (userId)");
                          return;
                        }

                        console.log(
                          `[polar] Subscription revoked: user=${userId} - downgrading to free`,
                        );

                        // Access has ended - downgrade to free plan
                        await updateUserPlan(userId, "free");

                        // Update run quota to free plan
                        // Set next reset to 1 month from now (since period has ended)
                        const billingEnd = addMonths(new Date(), 1);
                        await updateUserLoopRunQuota(userId, "free", billingEnd);
                      },
                      onOrderPaid: async (payload) => {
                        const userId = payload.data.customer.externalId;
                        const productId = payload.data.productId;

                        if (!userId) {
                          console.warn("[polar] Order paid but no externalId (userId)");
                          return;
                        }

                        if (!productId) {
                          console.warn("[polar] Order paid but no productId");
                          return;
                        }

                        const plan = getRunPackFromProductId(productId);

                        if (!plan) {
                          return;
                        }

                        const runs = RUN_PACK_TO_RUNS_MAP[plan];

                        if (!runs) {
                          return;
                        }

                        await recordUserLoopRunEvent(userId, runs);
                      },
                      onOrderRefunded: async (payload) => {
                        const userId = payload.data.customer.externalId;
                        const productId = payload.data.productId;

                        if (!userId) {
                          console.warn("[polar] Order refunded but no externalId (userId)");
                          return;
                        }

                        if (!productId) {
                          console.warn("[polar] Order refunded but no productId");
                          return;
                        }

                        const plan = getRunPackFromProductId(productId);

                        if (!plan) {
                          return;
                        }

                        const runs = RUN_PACK_TO_RUNS_MAP[plan];

                        if (!runs) {
                          return;
                        }

                        await recordUserLoopRunEvent(userId, runs, true);
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

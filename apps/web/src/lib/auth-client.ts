import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { polarClient } from "@polar-sh/better-auth/client";
import env from "@gitterm/env/web";

// Mirror the server's `user.additionalFields` (packages/auth/src/index.ts) so
// the client infers them on `session.user`. We use the runtime-config form of
// `inferAdditionalFields` (not the `<typeof auth>` generic) to avoid importing
// @gitterm/auth, which carries server-side database dependencies. The enum
// `type` arrays produce literal unions (e.g. `"free" | "starter" | "pro"`),
// matching the server config exactly.
const additionalFields = () =>
  inferAdditionalFields({
    user: {
      plan: { type: ["free", "starter", "pro"], input: false },
      role: { type: ["user", "admin"], input: false },
    },
  });

const isBillingEnabled = env.NEXT_PUBLIC_ENABLE_BILLING;
const authBaseUrl =
  env.NEXT_PUBLIC_AUTH_URL ??
  (env.NEXT_PUBLIC_SERVER_URL ? `${env.NEXT_PUBLIC_SERVER_URL}/api/auth` : undefined);

/**
 * Auth client for non-billing mode
 * Only includes the inferAdditionalFields plugin
 */
const createStandardAuthClient = () =>
  createAuthClient({
    baseURL: authBaseUrl,
    plugins: [additionalFields()],
  });

/**
 * Auth client for billing mode
 * Includes polarClient plugin for checkout, portal, usage, etc.
 *
 * Following the official Polar docs:
 * https://polar.sh/docs/integrate/sdk/adapters/better-auth
 *
 * Note: We use separate client creation and type assertion due to
 * peer dependency version mismatch between better-auth packages
 */
const createBillingAuthClient = () =>
  createAuthClient({
    baseURL: authBaseUrl,
    plugins: [additionalFields(), polarClient()],
  });

// Both factories register `inferAdditionalFields<AuthAdditionalFields>()`, so
// either client resolves `session.user.plan`/`role`. We pin the export to a
// single concrete client type (instead of a `A | B` union of the two
// factories) so TypeScript can actually infer the additional fields on
// `useSession()`/`getSession()` - a union collapses them back to the base
// better-auth `User`. Polar-only methods are accessed via `(authClient as any)`
// below, so narrowing the public type to the standard client loses nothing.
type AppAuthClient = ReturnType<typeof createStandardAuthClient>;

// Export the appropriate client based on billing status
export const authClient: AppAuthClient = (
  isBillingEnabled ? createBillingAuthClient() : createStandardAuthClient()
) as unknown as AppAuthClient;

// ============================================================================
// Polar Billing Helpers (only work when billing is enabled)
// ============================================================================

/**
 * Checkout slug types
 */
type CheckoutSlug = "starter" | "pro" | "run_pack_50" | "run_pack_100";

/**
 * Initiate checkout for a subscription plan or run pack
 * Redirects to Polar checkout page
 *
 * @param slug - Product slug ("starter", "pro", "run_pack_50", "run_pack_100")
 *
 * @example
 * await initiateCheckout("starter");
 * await initiateCheckout("pro");
 * await initiateCheckout("run_pack_50");
 */
export async function initiateCheckout(slug: CheckoutSlug) {
  if (!isBillingEnabled) {
    console.warn("[auth-client] Billing is not enabled. Checkout unavailable.");
    return;
  }

  // Store the selected plan/pack in sessionStorage so the success page can display it
  // This is needed because the webhook may not have updated the user's plan yet
  if (typeof window !== "undefined") {
    sessionStorage.setItem("checkout_plan", slug.replace("_", " "));
  }

  // The checkout method is added by the polarClient plugin
  // It accepts either { products: [...productIds] } or { slug: "..." }
  await (authClient as any).checkout({ slug });
}

/**
 * Initiate checkout with specific product IDs
 *
 * @param productIds - Array of Polar product IDs
 * @param referenceId - Optional reference ID (e.g., organization ID)
 */
export async function initiateCheckoutWithProducts(productIds: string[], referenceId?: string) {
  if (!isBillingEnabled) {
    console.warn("[auth-client] Billing is not enabled. Checkout unavailable.");
    return;
  }

  await (authClient as any).checkout({
    products: productIds,
    ...(referenceId && { referenceId }),
  });
}

/**
 * Open the Polar Customer Portal
 * Redirects to Polar portal where users can manage subscriptions, view orders, etc.
 */
export async function openCustomerPortal() {
  if (!isBillingEnabled) {
    console.warn("[auth-client] Billing is not enabled. Customer portal unavailable.");
    return;
  }

  // Portal redirect method from polarClient plugin
  await (authClient as any).customer.portal();
}

/**
 * Get the current customer state from Polar
 * Contains subscriptions, benefits, meters, etc.
 *
 * @returns Customer state object or null if billing is disabled
 */
export async function getCustomerState() {
  if (!isBillingEnabled) {
    return null;
  }

  try {
    const { data } = await (authClient as any).customer.state();
    return data;
  } catch (error) {
    console.error("[auth-client] Failed to get customer state:", error);
    return null;
  }
}

/**
 * List current user's subscriptions
 *
 * @param options - Pagination and filter options
 * @returns Subscriptions list or empty array if billing is disabled
 */
export async function listSubscriptions(options?: {
  page?: number;
  limit?: number;
  active?: boolean;
}) {
  if (!isBillingEnabled) {
    return { data: [], pagination: null };
  }

  try {
    const result = await (authClient as any).customer.subscriptions.list({
      query: {
        page: options?.page || 1,
        limit: options?.limit || 10,
        active: options?.active,
      },
    });
    return result;
  } catch (error) {
    console.error("[auth-client] Failed to list subscriptions:", error);
    return { data: [], pagination: null };
  }
}

/**
 * List current user's orders
 *
 * @param options - Pagination and filter options
 * @returns Orders list or empty array if billing is disabled
 */
export async function listOrders(options?: {
  page?: number;
  limit?: number;
  productBillingType?: "one_time" | "recurring";
}) {
  if (!isBillingEnabled) {
    return { data: [], pagination: null };
  }

  try {
    const result = await (authClient as any).customer.orders.list({
      query: {
        page: options?.page || 1,
        limit: options?.limit || 10,
        ...(options?.productBillingType && {
          productBillingType: options.productBillingType,
        }),
      },
    });
    return result;
  } catch (error) {
    console.error("[auth-client] Failed to list orders:", error);
    return { data: [], pagination: null };
  }
}

/**
 * List current user's granted benefits
 *
 * @param options - Pagination options
 * @returns Benefits list or empty array if billing is disabled
 */
export async function listBenefits(options?: { page?: number; limit?: number }) {
  if (!isBillingEnabled) {
    return { data: [], pagination: null };
  }

  try {
    const result = await (authClient as any).customer.benefits.list({
      query: {
        page: options?.page || 1,
        limit: options?.limit || 10,
      },
    });
    return result;
  } catch (error) {
    console.error("[auth-client] Failed to list benefits:", error);
    return { data: [], pagination: null };
  }
}

/**
 * Ingest a usage event for usage-based billing
 *
 * @param event - Event name (e.g., "workspace_minutes", "api_calls")
 * @param metadata - Event metadata with numeric or string values
 */
export async function ingestUsageEvent(
  event: string,
  metadata: Record<string, string | number | boolean>,
) {
  if (!isBillingEnabled) {
    return null;
  }

  try {
    const { data } = await (authClient as any).usage.ingestion({
      event,
      metadata,
    });
    return data;
  } catch (error) {
    console.error("[auth-client] Failed to ingest usage event:", error);
    return null;
  }
}

/**
 * List customer meters for usage-based billing
 *
 * @param options - Pagination options
 * @returns Customer meters or null if billing is disabled
 */
export async function listCustomerMeters(options?: { page?: number; limit?: number }) {
  if (!isBillingEnabled) {
    return null;
  }

  try {
    const { data } = await (authClient as any).usage.meters.list({
      query: {
        page: options?.page || 1,
        limit: options?.limit || 10,
      },
    });
    return data;
  } catch (error) {
    console.error("[auth-client] Failed to list customer meters:", error);
    return null;
  }
}

// Export billing status for conditional UI rendering
export { isBillingEnabled };

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { polarClient } from "@polar-sh/better-auth/client";
import env from "@gitterm/env/web";
import { apiPath } from "@gitterm/schema/url";

// Mirror the server's `user.additionalFields` (packages/auth/src/index.ts) so
// the client infers them on `session.user`. We use the runtime-config form of
// `inferAdditionalFields` (not the `<typeof auth>` generic) to avoid importing
// @gitterm/auth, which carries server-side database dependencies. Plans come
// from the billing API (`useBillingAccount`), not the session.
const additionalFields = () =>
  inferAdditionalFields({
    user: {
      role: { type: ["user", "admin"], input: false },
    },
  });

const isBillingEnabled = env.NEXT_PUBLIC_ENABLE_BILLING;
const authBaseUrl =
  env.NEXT_PUBLIC_AUTH_URL ??
  (env.NEXT_PUBLIC_SERVER_URL ? apiPath(env.NEXT_PUBLIC_SERVER_URL, "auth") : undefined);

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
 * Includes polarClient plugin for checkout and the customer portal.
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
// either client resolves `session.user.role`. We pin the export to a
// single concrete client type (instead of a `A | B` union of the two
// factories) so TypeScript can actually infer the additional fields on
// `useSession()`/`getSession()` - a union collapses them back to the base
// better-auth `User`. Polar-only methods are accessed via `(authClient as any)`
// below, so narrowing the public type to the standard client loses nothing.
type AppAuthClient = ReturnType<typeof createStandardAuthClient>;

// Export the appropriate client based on billing status
export const authClient: AppAuthClient = (isBillingEnabled
  ? createBillingAuthClient()
  : createStandardAuthClient()) as unknown as AppAuthClient;

// ============================================================================
// Polar Billing Helpers (only work when billing is enabled)
// ============================================================================

/**
 * Checkout slug types
 */
type CheckoutSlug = "pro" | "growth";

/**
 * Initiate checkout for a subscription plan
 * Redirects to Polar checkout page
 *
 * @param slug - Product slug ("pro", "growth")
 *
 * @example
 * await initiateCheckout("pro");
 * await initiateCheckout("growth");
 */
export async function initiateCheckout(slug: CheckoutSlug) {
  if (!isBillingEnabled) {
    console.warn("[auth-client] Billing is not enabled. Checkout unavailable.");
    return;
  }

  // Store the selected plan in sessionStorage so the success page can display it
  // This is needed because the webhook may not have updated the user's plan yet
  if (typeof window !== "undefined") {
    sessionStorage.setItem("checkout_plan", slug.replace("_", " "));
  }

  // The checkout method is added by the polarClient plugin
  // It accepts either { products: [...productIds] } or { slug: "..." }
  await (authClient as any).checkout({ slug });
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

// Export billing status for conditional UI rendering
export { isBillingEnabled };

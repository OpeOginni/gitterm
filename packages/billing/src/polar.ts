import { Polar } from "@polar-sh/sdk";
import env, { isBillingEnabled } from "@gitterm/env/auth";
import type { PlanId } from "./plans";

/** Null when no Polar access token is configured (e.g. local managed-mode development). */
export const polarClient = isBillingEnabled()
  ? new Polar({
      accessToken: env.POLAR_ACCESS_TOKEN!,
      server: env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
    })
  : null;

/** Subscription products, with the checkout slug the web app uses. */
export const polarProducts: Array<{ productId: string; slug: Exclude<PlanId, "free"> }> = [
  ...(env.POLAR_STARTER_PRODUCT_ID
    ? [{ productId: env.POLAR_STARTER_PRODUCT_ID, slug: "starter" as const }]
    : []),
  ...(env.POLAR_PRO_PRODUCT_ID
    ? [{ productId: env.POLAR_PRO_PRODUCT_ID, slug: "pro" as const }]
    : []),
];

export const getPlanForProduct = (productId: string): PlanId =>
  polarProducts.find((product) => product.productId === productId)?.slug ?? "free";

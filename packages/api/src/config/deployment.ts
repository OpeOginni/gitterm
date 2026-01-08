/**
 * Deployment Configuration
 *
 * Central configuration for deployment mode and environment-based settings.
 * This module determines whether system is running in self-hosted or managed mode.
 *
 * Self-hosted mode:
 * - No billing/payment processing
 * - No quota enforcement (unless enabled)
 * - Providers are managed via database (seeded and admin-controlled)
 * - Simplified auth options
 *
 * Managed mode:
 * - Full billing via Polar
 * - Quota enforcement based on subscription tier
 * - Railway as primary provider
 * - Full auth with GitHub OAuth
 */

import env, { isSelfHosted, isManaged } from "@gitterm/env/server";

/**
 * Current deployment mode
 * Defaults to 'self-hosted' for easier local development and self-hosting
 */
export const deploymentMode = env.DEPLOYMENT_MODE;

/**
 * Re-export isSelfHosted for backward compatibility
 */
export { isSelfHosted };

/**
 * Re-export isManaged for backward compatibility
 */
export { isManaged };

/**
 * Deployment configuration object
 * Centralizes all deployment-related settings
 */
export const deploymentConfig = {
  mode: deploymentMode,
  isSelfHosted: isSelfHosted(),
  isManaged: isManaged(),
} as const;

export default deploymentConfig;

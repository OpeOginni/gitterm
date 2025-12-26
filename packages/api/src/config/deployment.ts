/**
 * Deployment Configuration
 *
 * Central configuration for deployment mode and environment-based settings.
 * This module determines whether system is running in self-hosted or managed mode.
 *
 * Self-hosted mode:
 * - No billing/payment processing
 * - No quota enforcement
 * - Users can configure their own providers (Docker, K8s, Railway)
 * - Simplified auth options
 *
 * Managed mode:
 * - Full billing via Polar
 * - Quota enforcement based on subscription tier
 * - Railway as primary provider
 * - Full auth with GitHub OAuth
 */

import env, {
  isSelfHosted,
  isManaged,
  isProviderEnabled,
} from "@gitterm/env/server";

/**
 * Current deployment mode
 * Defaults to 'self-hosted' for easier local development and self-hosting
 */
export const deploymentMode = env.DEPLOYMENT_MODE;

/**
 * Enabled compute providers
 * Comma-separated list of provider names (e.g., "railway,local" or "docker,local")
 */
export const enabledProviders = env.ENABLED_PROVIDERS;

/**
 * Default compute provider for new workspaces
 */
export const defaultProvider: string = env.DEFAULT_PROVIDER || enabledProviders[0] || "local";

/**
 * Re-export isSelfHosted for backward compatibility
 */
export { isSelfHosted };

/**
 * Re-export isManaged for backward compatibility
 */
export { isManaged };

/**
 * Re-export isProviderEnabled for backward compatibility
 */
export { isProviderEnabled };

/**
 * Deployment configuration object
 * Centralizes all deployment-related settings
 */
export const deploymentConfig = {
  mode: deploymentMode,
  isSelfHosted: isSelfHosted(),
  isManaged: isManaged(),
  providers: {
    enabled: enabledProviders,
    default: defaultProvider,
  },
} as const;

export default deploymentConfig;

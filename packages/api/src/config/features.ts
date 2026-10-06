/**
 * Feature Flags
 *
 * Centralized feature flags for controlling functionality based on deployment mode.
 * Plans, quotas, and payments live in `@gitterm/billing`; see `../billing`.
 *
 * Usage:
 *   import { features, shouldMeterUsage } from '@gitterm/api/config/features';
 */

import env, { getGitHubAuthCredentials } from "@gitterm/env/server";
import { isSelfHosted, isManaged } from "./deployment";

export const features = {
  /**
   * Enable idle workspace reaping
   * Enabled by default in both modes (saves resources)
   */
  idleReaping: env.ENABLE_IDLE_REAPING,

  /**
   * Enable usage metering/tracking
   * Configurable in both modes, auto-enabled in managed for billing
   */
  usageMetering: env.ENABLE_USAGE_METERING || isManaged(),

  /**
   * Enable GitHub OAuth provider
   * Available only in managed mode with GitHub App OAuth credentials.
   */
  githubAuth: isManaged() && !!getGitHubAuthCredentials(),

  /**
   * Enable email/password authentication
   * Enabled by default for self-hosted flexibility
   */
  emailAuth: env.ENABLE_EMAIL_AUTH || isSelfHosted(),
} as const;

/**
 * Check if idle reaping should run
 */
export const shouldReapIdleWorkspaces = (): boolean => features.idleReaping;

/**
 * Check if usage should be metered
 */
export const shouldMeterUsage = (): boolean => features.usageMetering;

export default features;

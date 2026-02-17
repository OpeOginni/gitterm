/**
 * Feature Flags
 *
 * Centralized feature flags for controlling functionality based on deployment mode.
 *
 * Self-hosted mode: Simplified configuration with sensible defaults
 * Managed mode: Full feature set with billing, quotas, etc.
 *
 * Usage:
 *   import { features, shouldEnforceQuota } from '@gitterm/api/config/features';
 *
 *   if (shouldEnforceQuota()) {
 *     // Check user quota
 *   }
 */

import env from "@gitterm/env/server";
import { isSelfHosted, isManaged } from "./deployment";
import { getFreeTierDailyMinutes } from "../service/system-config";

/**
 * Feature flags configuration
 *
 * Self-hosted: Minimal flags exposed via env (ENABLE_QUOTA_ENFORCEMENT, ENABLE_IDLE_REAPING, etc.)
 * Managed: Most features auto-enabled based on deployment mode
 */
export const features = {
  /**
   * Enable billing/payment processing via Polar
   * Only enabled in managed mode (no env flag - internal only)
   */
  billing: isManaged(),

  /**
   * Enable quota enforcement (daily usage limits)
   * Configurable in both modes via ENABLE_QUOTA_ENFORCEMENT
   */
  quotaEnforcement: env.ENABLE_QUOTA_ENFORCEMENT || isManaged(),

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
   * Enable Discord notifications for new signups
   * Only in managed mode when Discord is configured (no env flag - internal only)
   */
  discordNotifications: isManaged() && !!env.DISCORD_TOKEN,

  /**
   * Enable GitHub OAuth provider
   * Auto-detected from GITHUB_CLIENT_ID presence
   */
  githubAuth: !!env.GITHUB_CLIENT_ID,

  /**
   * Enable email/password authentication
   * Enabled by default for self-hosted flexibility
   */
  emailAuth: env.ENABLE_EMAIL_AUTH || isSelfHosted(),
} as const;

// ============================================================================
// Feature Guard Functions
// These provide a cleaner API for checking features in code
// ============================================================================

/**
 * Check if billing should be processed
 */
export const shouldProcessBilling = (): boolean => features.billing;

/**
 * Check if quota should be enforced
 */
export const shouldEnforceQuota = (): boolean => features.quotaEnforcement;

/**
 * Check if idle reaping should run
 */
export const shouldReapIdleWorkspaces = (): boolean => features.idleReaping;

/**
 * Check if usage should be metered
 */
export const shouldMeterUsage = (): boolean => features.usageMetering;

/**
 * Check if Discord notifications should be sent
 */
export const shouldNotifyDiscord = (): boolean => features.discordNotifications;

// ============================================================================
// Plan Types
// ============================================================================

/**
 * Available user plans
 *
 * - free: Basic access, 10 sandbox runs/month
 * - pro: Full access with 100 runs/month and premium features
 */
export type UserPlan = "free" | "pro";


// ============================================================================
// Plan Feature Matrix
// ============================================================================


/**
 * Monthly sandbox run quotas by plan
 */
export const MONTHLY_RUN_QUOTAS: Record<UserPlan, number> = {
  free: 10,
  pro: 100,
};

/**
 * Daily cloud hosting minute quotas by plan (legacy, kept for compatibility)
 */
const DAILY_MINUTE_QUOTAS: Record<UserPlan, number> = {
  free: 60, // 1 hour
  pro: Infinity,
};

// ============================================================================
// Plan Guard Functions
// ============================================================================

/**
 * Get daily minute quota for a plan
 * In self-hosted mode, returns Infinity (unlimited)
 */
export const getDailyMinuteQuota = (plan: UserPlan): number => {
  if (isSelfHosted()) return Infinity;

  return DAILY_MINUTE_QUOTAS[plan] ?? DAILY_MINUTE_QUOTAS.free;
};

/**
 * Get daily minute quota for a plan (async version)
 * Uses database config for free tier quota
 * In self-hosted mode, returns Infinity (unlimited)
 */
export const getDailyMinuteQuotaAsync = async (plan: UserPlan): Promise<number> => {
  if (isSelfHosted()) return Infinity;

  // Pro has unlimited
  if (plan === "pro") {
    return Infinity;
  }

  // Free tier uses configurable quota from database
  return getFreeTierDailyMinutes();
};

/**
 * Get monthly run quota for a plan
 * In self-hosted mode, returns Infinity (unlimited)
 */
export const getMonthlyRunQuota = (plan: UserPlan): number => {
  if (isSelfHosted()) return Infinity;

  return MONTHLY_RUN_QUOTAS[plan] ?? MONTHLY_RUN_QUOTAS.free;
};

/**
 * Check if a plan can use custom cloud subdomains
 */
export const canUseCustomCloudSubdomain = (plan: UserPlan | string): boolean => {
  if (isSelfHosted()) return true;
  return plan === "pro";
};

/**
 * Check if a plan has unlimited cloud minutes
 */
export const hasUnlimitedCloudMinutes = (plan: UserPlan | string): boolean => {
  if (isSelfHosted()) return true;
  return plan === "pro";
};

/**
 * Get plan display info for UI
 */
export const getPlanInfo = (
  plan: UserPlan,
): {
  name: string;
  description: string;
  badge?: "popular" | "best-value";
} => {
  const planInfo: Record<UserPlan, ReturnType<typeof getPlanInfo>> = {
    free: {
      name: "Free",
      description: "10 sandbox runs/month to try agentic coding",
    },
    pro: {
      name: "Pro",
      description: "100 runs/month with premium features",
      badge: "popular",
    },
  };

  return planInfo[plan] ?? planInfo.free;
};

export default features;

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
   * Enable local tunnels (like ngrok)
   * Enabled by default in both modes
   */
  localTunnels: env.ENABLE_LOCAL_TUNNELS,

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
 * - free: Basic access, limited cloud hosting minutes, no subdomain
 * - tunnel: Tunnel subdomain only, same cloud limits as free
 * - pro: Full access with subdomain and unlimited cloud hosting
 */
export type UserPlan = "free" | "tunnel" | "pro";

/**
 * Plan features available for gating
 */
export type PlanFeature =
  | "customSubdomain" // Custom subdomain for any workspace (local or cloud)
  | "cloudHosting" // Access to cloud-hosted workspaces
  | "unlimitedCloudMinutes" // No daily limit on cloud usage
  | "multiRegion" // Deploy to multiple regions
  | "prioritySupport"; // Priority support channel

// ============================================================================
// Plan Feature Matrix
// ============================================================================

/**
 * Feature availability matrix by plan
 *
 * | Feature              | Free  | Tunnel | Pro   |
 * |----------------------|-------|--------|-------|
 * | customSubdomain      | No    | Yes    | Yes   |
 * | cloudHosting         | Yes   | Yes    | Yes   |
 * | unlimitedCloudMinutes| No    | No     | Yes   |
 * | multiRegion          | No    | No     | Yes   |
 * | prioritySupport      | No    | No     | No    |
 */
const PLAN_FEATURE_MATRIX: Record<PlanFeature, Record<UserPlan, boolean>> = {
  customSubdomain: { free: false, tunnel: true, pro: true },
  cloudHosting: { free: true, tunnel: true, pro: true },
  unlimitedCloudMinutes: { free: false, tunnel: false, pro: true },
  multiRegion: { free: false, tunnel: false, pro: true },
  prioritySupport: { free: false, tunnel: false, pro: false },
};

/**
 * Daily cloud hosting minute quotas by plan
 */
const DAILY_MINUTE_QUOTAS: Record<UserPlan, number> = {
  free: 60, // 1 hour
  tunnel: 60, // Same as free - tunnel plan is for local dev
  pro: Infinity,
};

// ============================================================================
// Plan Guard Functions
// ============================================================================

/**
 * Check if a user plan has access to a feature
 * Used for plan-based feature gating in managed mode
 */
export const planHasFeature = (plan: UserPlan, feature: PlanFeature): boolean => {
  if (isSelfHosted()) return true;

  return PLAN_FEATURE_MATRIX[feature]?.[plan] ?? false;
};

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

  // Free and tunnel tiers use configurable quota from database
  return getFreeTierDailyMinutes();
};

/**
 * Check if a plan can use custom subdomains
 */
export const canUseCustomSubdomain = (plan: UserPlan): boolean => {
  return planHasFeature(plan, "customSubdomain");
};

/**
 * Check if a plan has unlimited cloud minutes
 */
export const hasUnlimitedCloudMinutes = (plan: UserPlan): boolean => {
  return planHasFeature(plan, "unlimitedCloudMinutes");
};

/**
 * Get plan display info for UI
 */
export const getPlanInfo = (plan: UserPlan): {
  name: string;
  description: string;
  badge?: "popular" | "best-value";
} => {
  const planInfo: Record<UserPlan, ReturnType<typeof getPlanInfo>> = {
    free: {
      name: "Free",
      description: "Basic access with limited cloud hosting",
    },
    tunnel: {
      name: "Tunnel",
      description: "Custom subdomain for local development",
    },
    pro: {
      name: "Pro",
      description: "Full access with unlimited cloud hosting",
      badge: "popular",
    },
  };

  return planInfo[plan] ?? planInfo.free;
};

export default features;

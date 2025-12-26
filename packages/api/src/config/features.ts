/**
 * Feature Flags
 *
 * Centralized feature flags for controlling functionality based on deployment mode.
 * Features can be toggled via environment variables or derived from deployment mode.
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

/**
 * Feature flags configuration
 */
export const features = {
  /**
   * Enable billing/payment processing via Polar
   * Only enabled in managed mode by default
   */
  billing: env.ENABLE_BILLING || isManaged(),

  /**
   * Enable quota enforcement (daily usage limits)
   * Only enabled in managed mode by default
   */
  quotaEnforcement: env.ENABLE_QUOTA_ENFORCEMENT || isManaged(),

  /**
   * Enable idle workspace reaping
   * Enabled by default in both modes (saves resources)
   */
  idleReaping: env.ENABLE_IDLE_REAPING,

  /**
   * Enable usage metering/tracking
   * Enabled in managed mode for billing, optional in self-hosted
   */
  usageMetering: env.ENABLE_USAGE_METERING || isManaged(),

  /**
   * Enable Discord notifications for new signups
   * Only in managed mode by default
   */
  discordNotifications: env.ENABLE_DISCORD_NOTIFICATIONS || isManaged(),

  /**
   * Enable multi-region support
   * Typically only relevant for managed deployments with Railway
   */
  multiRegion: env.ENABLE_MULTI_REGION || isManaged(),

  /**
   * Enable custom subdomains for workspaces
   * Can be enabled in both modes
   */
  customSubdomains: env.ENABLE_CUSTOM_SUBDOMAINS,

  /**
   * Enable local tunnels (like ngrok)
   * Enabled by default in both modes
   */
  localTunnels: env.ENABLE_LOCAL_TUNNELS,

  /**
   * Enable GitHub OAuth provider
   * Can be disabled for self-hosted if using email/password only
   */
  githubAuth: env.ENABLE_GITHUB_AUTH || !!env.GITHUB_CLIENT_ID,

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
 * - enterprise: Pro features + priority support
 */
export type UserPlan = "free" | "tunnel" | "pro" | "enterprise";

/**
 * Plan features available for gating
 */
export type PlanFeature =
  | "tunnelSubdomain" // Custom subdomain for local tunnel connections
  | "cloudSubdomain" // Custom subdomain for cloud workspaces
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
 * | Feature              | Free  | Tunnel | Pro   | Enterprise |
 * |----------------------|-------|--------|-------|------------|
 * | tunnelSubdomain      | No    | Yes    | Yes   | Yes        |
 * | cloudSubdomain       | No    | No     | Yes   | Yes        |
 * | cloudHosting         | Yes   | Yes    | Yes   | Yes        |
 * | unlimitedCloudMinutes| No    | No     | Yes   | Yes        |
 * | multiRegion          | No    | No     | Yes   | Yes        |
 * | prioritySupport      | No    | No     | No    | Yes        |
 */
const PLAN_FEATURE_MATRIX: Record<PlanFeature, Record<UserPlan, boolean>> = {
  tunnelSubdomain: { free: false, tunnel: true, pro: true, enterprise: true },
  cloudSubdomain: { free: false, tunnel: false, pro: true, enterprise: true },
  cloudHosting: { free: true, tunnel: true, pro: true, enterprise: true },
  unlimitedCloudMinutes: { free: false, tunnel: false, pro: true, enterprise: true },
  multiRegion: { free: false, tunnel: false, pro: true, enterprise: true },
  prioritySupport: { free: false, tunnel: false, pro: false, enterprise: true },
};

/**
 * Daily cloud hosting minute quotas by plan
 */
const DAILY_MINUTE_QUOTAS: Record<UserPlan, number> = {
  free: 60, // 1 hour
  tunnel: 60, // Same as free - tunnel plan is for local dev
  pro: Infinity,
  enterprise: Infinity,
};

// ============================================================================
// Plan Guard Functions
// ============================================================================

/**
 * Check if a user plan has access to a feature
 * Used for plan-based feature gating in managed mode
 */
export const planHasFeature = (plan: UserPlan, feature: PlanFeature): boolean => {
  // In self-hosted mode, all features are available
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
 * Check if a plan can use tunnel subdomains
 */
export const canUseTunnelSubdomain = (plan: UserPlan): boolean => {
  return planHasFeature(plan, "tunnelSubdomain");
};

/**
 * Check if a plan can use cloud subdomains
 */
export const canUseCloudSubdomain = (plan: UserPlan): boolean => {
  return planHasFeature(plan, "cloudSubdomain");
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
    enterprise: {
      name: "Enterprise",
      description: "Pro features with priority support",
      badge: "best-value",
    },
  };

  return planInfo[plan] ?? planInfo.free;
};

export default features;

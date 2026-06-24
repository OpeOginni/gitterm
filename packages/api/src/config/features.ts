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

import env, { getGitHubAuthCredentials } from "@gitterm/env/server";
import { isSelfHosted, isManaged } from "./deployment";
import { getFreeTierDailyMinutes } from "../service/config/system-config";

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
   * Auto-detected from GitHub App OAuth credentials presence.
   */
  githubAuth: !!getGitHubAuthCredentials(),

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
 * - free: Basic trial access. E2B sandbox only, no persistence.
 * - starter: Entry paid tier. All providers, persistence, higher quotas.
 * - pro: Main paid tier. All providers, persistence, highest quotas, branding.
 *
 * NOTE: All paid plans have FINITE quotas in managed mode. Only self-hosted
 * deployments are unlimited. There is intentionally no "unlimited" managed tier
 * because every running workspace consumes provider compute we pay for.
 */
export type UserPlan = "free" | "starter" | "pro";

/**
 * Order plans low -> high so we can compare tiers when gating features.
 */
export const PLAN_RANK: Record<UserPlan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
};

// ============================================================================
// Plan Feature Matrix
// ============================================================================
//
// This is the single source of truth for what each tier gets in managed mode.
// Self-hosted deployments bypass these limits entirely (see guard functions).
// Keep packages/auth/src/index.ts MONTHLY_RUN_QUOTAS in sync with this.

export interface PlanLimits {
  /** Monthly autonomous agent-loop runs. */
  monthlyRuns: number;
  /** Maximum total workspaces (running, pending, or stopped). */
  workspaces: number;
  /** Daily cloud runtime minutes before the workspace is stopped. */
  dailyMinutes: number;
  /** Minutes of inactivity before the idle reaper stops a workspace. */
  idleTimeoutMinutes: number;
  /**
   * Days of inactivity before the reaper terminates (deletes) a workspace,
   * tearing down any persisted volume. Higher tiers keep instances longer.
   */
  retentionDays: number;
  /** Whether the user can create persistent (volume-backed) workspaces. */
  persistence: boolean;
  /** Whether the user can reserve custom cloud subdomains for branding. */
  customSubdomain: boolean;
  /**
   * Provider keys this plan may use. `null` means "all enabled providers".
   * Free is intentionally restricted to E2B only.
   */
  allowedProviderKeys: string[] | null;
}

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    monthlyRuns: 10,
    workspaces: 2,
    dailyMinutes: 60,
    idleTimeoutMinutes: 10,
    retentionDays: 2,
    persistence: false,
    customSubdomain: false,
    allowedProviderKeys: ["e2b"],
  },
  starter: {
    monthlyRuns: 75,
    workspaces: 5,
    dailyMinutes: 180,
    idleTimeoutMinutes: 20,
    retentionDays: 7,
    persistence: true,
    customSubdomain: true,
    allowedProviderKeys: null,
  },
  pro: {
    monthlyRuns: 250,
    workspaces: 15,
    dailyMinutes: 480,
    idleTimeoutMinutes: 30,
    retentionDays: 15,
    persistence: true,
    customSubdomain: true,
    allowedProviderKeys: null,
  },
};

const getPlanLimits = (plan: UserPlan | string): PlanLimits =>
  PLAN_LIMITS[(plan as UserPlan)] ?? PLAN_LIMITS.free;

/**
 * Monthly sandbox run quotas by plan
 * @deprecated Prefer `getMonthlyRunQuota` / `PLAN_LIMITS`. Kept for compatibility.
 */
export const MONTHLY_RUN_QUOTAS: Record<UserPlan, number> = {
  free: PLAN_LIMITS.free.monthlyRuns,
  starter: PLAN_LIMITS.starter.monthlyRuns,
  pro: PLAN_LIMITS.pro.monthlyRuns,
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

  return getPlanLimits(plan).dailyMinutes;
};

/**
 * Get daily minute quota for a plan (async version)
 * Uses database config for free tier quota so admins can tune it at runtime.
 * In self-hosted mode, returns Infinity (unlimited)
 */
export const getDailyMinuteQuotaAsync = async (plan: UserPlan): Promise<number> => {
  if (isSelfHosted()) return Infinity;

  // Free tier is admin-tunable via system config.
  if (plan === "free") {
    return getFreeTierDailyMinutes();
  }

  return getPlanLimits(plan).dailyMinutes;
};

/**
 * Get monthly run quota for a plan
 * In self-hosted mode, returns Infinity (unlimited)
 */
export const getMonthlyRunQuota = (plan: UserPlan): number => {
  if (isSelfHosted()) return Infinity;

  return getPlanLimits(plan).monthlyRuns;
};

/**
 * Get the idle timeout (minutes) that should apply to a plan's workspaces.
 * Returns `null` in self-hosted mode, signalling callers to fall back to the
 * single global system-config value (admin-tuned, plan-agnostic).
 */
export const getIdleTimeoutMinutesForPlan = (plan: UserPlan | string): number | null => {
  if (isSelfHosted()) return null;
  return getPlanLimits(plan).idleTimeoutMinutes;
};

/**
 * Get the retention window (days of inactivity) before the reaper terminates a
 * plan's workspaces. Returns `null` in self-hosted mode, signalling callers
 * that managed retention does not apply (self-hosted instances are not reaped).
 */
export const getRetentionDaysForPlan = (plan: UserPlan | string): number | null => {
  if (isSelfHosted()) return null;
  return getPlanLimits(plan).retentionDays;
};

/**
 * Check if a plan can use custom cloud subdomains
 */
export const canUseCustomCloudSubdomain = (plan: UserPlan | string): boolean => {
  if (isSelfHosted()) return true;
  return getPlanLimits(plan).customSubdomain;
};

/**
 * Check if a plan can create persistent (volume-backed) workspaces.
 */
export const canCreatePersistentWorkspace = (plan: UserPlan | string): boolean => {
  if (isSelfHosted()) return true;
  return getPlanLimits(plan).persistence;
};

/**
 * Get the provider keys a plan is allowed to use.
 * Returns `null` when the plan may use any enabled provider (all paid plans and
 * self-hosted). Free is restricted to E2B only.
 */
export const getAllowedProviderKeys = (plan: UserPlan | string): string[] | null => {
  if (isSelfHosted()) return null;
  return getPlanLimits(plan).allowedProviderKeys;
};

/**
 * Check whether a plan may use a specific provider key.
 */
export const canUseProvider = (plan: UserPlan | string, providerKey: string): boolean => {
  const allowed = getAllowedProviderKeys(plan);
  if (allowed === null) return true;
  return allowed.includes(providerKey.toLowerCase());
};

/**
 * Check if a plan has unlimited cloud minutes.
 * Only self-hosted deployments are unlimited; no managed tier is unlimited.
 */
export const hasUnlimitedCloudMinutes = (_plan: UserPlan | string): boolean => {
  return isSelfHosted();
};

/**
 * Get workspace limit for a plan
 * In self-hosted mode, returns Infinity (unlimited)
 */
export const getWorkspaceLimit = (plan: UserPlan): number => {
  if (isSelfHosted()) return Infinity;
  return getPlanLimits(plan).workspaces;
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
      description: "60 min/day on E2B sandboxes with up to 2 workspaces",
    },
    starter: {
      name: "Starter",
      description: "180 min/day, all providers, persistence, custom subdomains, up to 5 workspaces",
      badge: "best-value",
    },
    pro: {
      name: "Pro",
      description: "480 min/day, all providers, persistence, up to 15 workspaces",
      badge: "popular",
    },
  };

  return planInfo[plan] ?? planInfo.free;
};

export default features;

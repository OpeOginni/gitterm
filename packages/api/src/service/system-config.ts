/**
 * System Configuration Service
 * 
 * Manages runtime-configurable system settings stored in the database.
 * Used for admin-adjustable values like idle timeout and daily quotas.
 * 
 * Settings are cached in memory and refreshed periodically to avoid
 * excessive database reads while still allowing runtime changes.
 */

import { db, eq } from "@gitterm/db";
import { systemConfig } from "@gitterm/db/schema/auth";

// ============================================================================
// Configuration Keys and Defaults
// ============================================================================

/**
 * Available system configuration keys
 */
export type SystemConfigKey = 
  | "idle_timeout_minutes"
  | "free_tier_daily_minutes";

/**
 * Default values for each configuration key
 * Used when no database value exists
 */
const DEFAULTS: Record<SystemConfigKey, number> = {
  idle_timeout_minutes: 30,        // 30 minutes idle before workspace is stopped
  free_tier_daily_minutes: 60,     // 60 minutes (1 hour) per day for free users
};

/**
 * Human-readable descriptions for each setting
 */
export const CONFIG_DESCRIPTIONS: Record<SystemConfigKey, { label: string; description: string; min: number; max: number }> = {
  idle_timeout_minutes: {
    label: "Idle Timeout",
    description: "Minutes of inactivity before a workspace is automatically stopped",
    min: 5,
    max: 120,
  },
  free_tier_daily_minutes: {
    label: "Free Tier Daily Minutes",
    description: "Daily usage quota (in minutes) for free tier users. Set to 0 for unlimited.",
    min: 0,
    max: 1440, // 24 hours
  },
};

// ============================================================================
// Cache for performance
// ============================================================================

interface CacheEntry {
  value: number;
  timestamp: number;
}

const cache = new Map<SystemConfigKey, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache TTL

/**
 * Clear the config cache (useful after updates)
 */
export function clearConfigCache(): void {
  cache.clear();
}

// ============================================================================
// Read/Write Functions
// ============================================================================

/**
 * Get a system configuration value
 * Returns the database value if set, otherwise the default
 */
export async function getSystemConfig(key: SystemConfigKey): Promise<number> {
  // Check cache first
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);
    
    const value = config ? parseInt(config.value, 10) : DEFAULTS[key];
    
    // Update cache
    cache.set(key, { value, timestamp: Date.now() });
    
    return value;
  } catch (error) {
    console.error(`[system-config] Failed to get ${key}:`, error);
    return DEFAULTS[key];
  }
}

/**
 * Set a system configuration value
 * Uses upsert to create or update the value
 */
export async function setSystemConfig(key: SystemConfigKey, value: number): Promise<void> {
  const config = CONFIG_DESCRIPTIONS[key];
  
  // Validate value is within bounds
  if (value < config.min || value > config.max) {
    throw new Error(`Value for ${key} must be between ${config.min} and ${config.max}`);
  }

  await db
    .insert(systemConfig)
    .values({
      key,
      value: value.toString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: value.toString(),
        updatedAt: new Date(),
      },
    });

  // Clear cache for this key
  cache.delete(key);
  
  console.log(`[system-config] Updated ${key} to ${value}`);
}

/**
 * Get all system configuration values
 */
export async function getAllSystemConfig(): Promise<Record<SystemConfigKey, number>> {
  const keys = Object.keys(DEFAULTS) as SystemConfigKey[];
  const result: Record<string, number> = {};
  
  for (const key of keys) {
    result[key] = await getSystemConfig(key);
  }
  
  return result as Record<SystemConfigKey, number>;
}

/**
 * Get the default value for a configuration key
 */
export function getDefaultValue(key: SystemConfigKey): number {
  return DEFAULTS[key];
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the idle timeout in minutes
 */
export async function getIdleTimeoutMinutes(): Promise<number> {
  return getSystemConfig("idle_timeout_minutes");
}

/**
 * Get the free tier daily minute quota
 */
export async function getFreeTierDailyMinutes(): Promise<number> {
  return getSystemConfig("free_tier_daily_minutes");
}

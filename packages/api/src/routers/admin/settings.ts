/**
 * Admin Settings Router
 * 
 * Manages system-wide configuration settings that can be adjusted by admins.
 * Settings include idle timeout, daily quotas, and other runtime-configurable values.
 */

import { z } from "zod";
import { adminProcedure, router } from "../..";
import { 
  getAllSystemConfig, 
  setSystemConfig, 
  CONFIG_DESCRIPTIONS,
  type SystemConfigKey,
  clearConfigCache,
} from "../../service/system-config";

// ============================================================================
// Input Schemas
// ============================================================================

const updateSettingsSchema = z.object({
  idle_timeout_minutes: z.number().min(5).max(120).optional(),
  free_tier_daily_minutes: z.number().min(0).max(1440).optional(),
});

// ============================================================================
// Router
// ============================================================================

export const settingsRouter = router({
  /**
   * Get all system settings with their current values and metadata
   */
  get: adminProcedure.query(async () => {
    const values = await getAllSystemConfig();
    
    // Combine values with descriptions for the UI
    const settings = Object.entries(values).map(([key, value]) => {
      const config = CONFIG_DESCRIPTIONS[key as SystemConfigKey];
      return {
        key,
        value,
        label: config.label,
        description: config.description,
        min: config.min,
        max: config.max,
      };
    });
    
    return { settings };
  }),

  /**
   * Update one or more system settings
   */
  update: adminProcedure
    .input(updateSettingsSchema)
    .mutation(async ({ input }) => {
      const updates: string[] = [];
      
      if (input.idle_timeout_minutes !== undefined) {
        await setSystemConfig("idle_timeout_minutes", input.idle_timeout_minutes);
        updates.push(`idle_timeout_minutes: ${input.idle_timeout_minutes}`);
      }
      
      if (input.free_tier_daily_minutes !== undefined) {
        await setSystemConfig("free_tier_daily_minutes", input.free_tier_daily_minutes);
        updates.push(`free_tier_daily_minutes: ${input.free_tier_daily_minutes}`);
      }
      
      // Clear cache to ensure new values are used immediately
      clearConfigCache();
      
      return { 
        success: true, 
        updated: updates,
      };
    }),
});

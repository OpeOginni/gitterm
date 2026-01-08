/**
 * Admin Router
 *
 * Provides admin-only endpoints for managing:
 * - Cloud providers
 * - Regions
 * - Agent types
 * - Images
 * - Users
 * - System configuration
 * - System settings (idle timeout, quotas, etc.)
 */

import { router, adminProcedure } from "../..";
import { infrastructureRouter } from "./infrastructure";
import { usersRouter } from "./users";
import { settingsRouter } from "./settings";
import { isGitHubAuthEnabled, isEmailAuthEnabled } from "@gitterm/env/server";

export const adminRouter = router({
  infrastructure: infrastructureRouter,
  users: usersRouter,
  settings: settingsRouter,

  /**
   * Get system configuration for the admin panel.
   * Returns auth settings and feature flags relevant to admin operations.
   */
  config: adminProcedure.query(() => {
    return {
      auth: {
        emailEnabled: isEmailAuthEnabled(),
        githubEnabled: isGitHubAuthEnabled(),
        // Admin can create users only when email-only auth is enabled
        canCreateUsers: isEmailAuthEnabled() && !isGitHubAuthEnabled(),
      },
    };
  }),
});

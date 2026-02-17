/**
 * Server Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/server';
 */

import {
  z,
  parseEnv,
  deploymentMode,
  polarEnvironment,
  routingMode,
  optional,
  boolWithDefault,
  nodeEnv,
} from "./index";

const baseSchema = z
  .object({
    NODE_ENV: nodeEnv,
    PORT: z
      .string()
      .default("8080")
      .transform((val) => parseInt(val, 10)),

    // Deployment
    DEPLOYMENT_MODE: deploymentMode,

    // Admin bootstrap (for self-hosted)
    ADMIN_EMAIL: optional,
    ADMIN_PASSWORD: optional,

    // URLs
    BASE_URL: optional,
    BASE_DOMAIN: z.string().default("gitterm.dev"),
    CORS_ORIGIN: optional,
    BETTER_AUTH_URL: optional,
    BETTER_AUTH_SECRET: optional, // Required but handled by auth package
    API_URL: optional,

    // Database & Redis
    DATABASE_URL: optional, // Required but may be set elsewhere
    REDIS_URL: optional,

    // Internal
    INTERNAL_API_KEY: optional,
    DEVICE_CODE_VERIFICATION_URI: optional,

    // GitHub OAuth
    GITHUB_CLIENT_ID: optional,
    GITHUB_CLIENT_SECRET: optional,

    // GitHub App (either both or neither)
    GITHUB_APP_ID: optional,
    GITHUB_APP_PRIVATE_KEY: optional,
    GITHUB_WEBHOOK_SECRET: z.string().optional().default(""),

    // Polar (conditionally required in managed mode)
    POLAR_ACCESS_TOKEN: optional,
    POLAR_WEBHOOK_SECRET: optional,
    POLAR_ENVIRONMENT: polarEnvironment,
    POLAR_PRO_PRODUCT_ID: optional,
    POLAR_RUN_PACK_50_PRODUCT_ID: optional,
    POLAR_RUN_PACK_100_PRODUCT_ID: optional,

    // Listener (for internal callbacks)
    LISTENER_URL: optional,

    // Tunnel
    CLI_JWT_SECRET: optional,
    WORKSPACE_JWT_SECRET: optional,

    // Encryption (for storing API keys/credentials)
    ENCRYPTION_MASTER_KEY: optional, // 32-byte key in hex (64 chars) for AES-256-GCM

    // Routing
    ROUTING_MODE: routingMode,

    // Discord (optional unless ENABLE_DISCORD_NOTIFICATIONS is true)
    DISCORD_TOKEN: optional,
    DISCORD_DM_CHANNEL_ID: optional,

    // Feature flags (for self-hosted customization)
    ENABLE_QUOTA_ENFORCEMENT: boolWithDefault(false),
    ENABLE_IDLE_REAPING: boolWithDefault(true),
    ENABLE_USAGE_METERING: boolWithDefault(false),
    ENABLE_EMAIL_AUTH: boolWithDefault(true),
    ENABLE_GITHUB_AUTH: boolWithDefault(false),
    // ... keep the z.object({ ... }) as-is ...
  })
  .superRefine((data, ctx) => {
    const errors: { path: string; message: string }[] = [];

    // Managed mode requires Polar billing configuration
    if (data.DEPLOYMENT_MODE === "managed") {
      if (!data.POLAR_ACCESS_TOKEN) {
        errors.push({
          path: "POLAR_ACCESS_TOKEN",
          message: "POLAR_ACCESS_TOKEN is required in managed mode",
        });
      }
      if (!data.POLAR_WEBHOOK_SECRET) {
        errors.push({
          path: "POLAR_WEBHOOK_SECRET",
          message: "POLAR_WEBHOOK_SECRET is required in managed mode",
        });
      }
      if (!data.POLAR_PRO_PRODUCT_ID) {
        errors.push({
          path: "POLAR_PRO_PRODUCT_ID",
          message: "POLAR_PRO_PRODUCT_ID is required in managed mode",
        });
      }
    }

    // GitHub auth requires GitHub OAuth credentials
    if (data.ENABLE_GITHUB_AUTH) {
      if (!data.GITHUB_CLIENT_ID) {
        errors.push({
          path: "GITHUB_CLIENT_ID",
          message: "GITHUB_CLIENT_ID is required when ENABLE_GITHUB_AUTH is true",
        });
      }
      if (!data.GITHUB_CLIENT_SECRET) {
        errors.push({
          path: "GITHUB_CLIENT_SECRET",
          message: "GITHUB_CLIENT_SECRET is required when ENABLE_GITHUB_AUTH is true",
        });
      }
    }

    // Railway provider requires Railway configuration when used
    // Note: Railway config is optional - only needed if Railway provider is in the database
    // Validation happens at runtime when trying to use Railway provider

    // Discord notifications require Discord configuration (managed mode only)
    if (data.DEPLOYMENT_MODE === "managed" && data.DISCORD_TOKEN) {
      if (!data.DISCORD_DM_CHANNEL_ID) {
        errors.push({
          path: "DISCORD_DM_CHANNEL_ID",
          message: "DISCORD_DM_CHANNEL_ID is required when DISCORD_TOKEN is set",
        });
      }
    }

    // GitHub App integration: either both or neither
    const hasAppId = !!data.GITHUB_APP_ID;
    const hasPrivateKey = !!data.GITHUB_APP_PRIVATE_KEY;
    if ((hasAppId && !hasPrivateKey) || (!hasAppId && hasPrivateKey)) {
      errors.push({
        path: "GITHUB_APP_ID",
        message: "Both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set together (or neither)",
      });
    }

    // Admin credentials: either both or neither (for self-hosted bootstrap)
    const hasAdminEmail = !!data.ADMIN_EMAIL;
    const hasAdminPassword = !!data.ADMIN_PASSWORD;
    if ((hasAdminEmail && !hasAdminPassword) || (!hasAdminEmail && hasAdminPassword)) {
      errors.push({
        path: "ADMIN_EMAIL",
        message: "Both ADMIN_EMAIL and ADMIN_PASSWORD must be set together (or neither)",
      });
    }

    for (const e of errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [e.path],
        message: e.message,
      });
    }
  });

export type ServerEnv = z.infer<typeof baseSchema>;

const env = parseEnv(baseSchema);
export default env;

// Helpers
export const isManaged = () => env.DEPLOYMENT_MODE === "managed";
export const isSelfHosted = () => env.DEPLOYMENT_MODE === "self-hosted";
export const isBillingEnabled = () => isManaged() && !!env.POLAR_ACCESS_TOKEN;
export const isGitHubAuthEnabled = () => env.ENABLE_GITHUB_AUTH;
export const isEmailAuthEnabled = () => env.ENABLE_EMAIL_AUTH;
export const isSubdomainRouting = () => env.ROUTING_MODE === "subdomain";
export const isPathRouting = () => env.ROUTING_MODE === "path";

/**
 * Check if admin bootstrap is configured and applicable.
 * Admin bootstrap only applies when:
 * - ADMIN_EMAIL and ADMIN_PASSWORD are both set
 * - Email auth is enabled
 * - GitHub auth is NOT enabled (otherwise use OAuth flow)
 */
export const hasAdminBootstrap = () =>
  !!env.ADMIN_EMAIL && !!env.ADMIN_PASSWORD && isEmailAuthEnabled() && !isGitHubAuthEnabled();
export const getAdminCredentials = () =>
  hasAdminBootstrap() ? { email: env.ADMIN_EMAIL!, password: env.ADMIN_PASSWORD! } : null;

export { baseSchema as serverEnvSchema };

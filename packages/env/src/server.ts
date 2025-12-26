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
  providersList,
  computeProvider,
  polarEnvironment,
  routingMode,
  optional,
  boolWithDefault,
  nodeEnv,
} from "./index";

const baseSchema = z.object({
  NODE_ENV: nodeEnv,
  PORT: z.string().default("8080").transform((val) => parseInt(val, 10)),

  // Deployment
  DEPLOYMENT_MODE: deploymentMode,
  ENABLED_PROVIDERS: providersList,
  DEFAULT_PROVIDER: computeProvider.optional(),

  // URLs
  BASE_URL: optional,
  BASE_DOMAIN: z.string().default("gitterm.dev"),
  CORS_ORIGIN: optional,
  BETTER_AUTH_URL: optional,
  BETTER_AUTH_SECRET: optional, // Required but handled by auth package
  API_URL: optional,
  TUNNEL_URL: optional,

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

  // Polar (conditionally required in managed mode)
  POLAR_ACCESS_TOKEN: optional,
  POLAR_WEBHOOK_SECRET: optional,
  POLAR_ENVIRONMENT: polarEnvironment,
  POLAR_TUNNEL_PRODUCT_ID: optional,
  POLAR_PRO_PRODUCT_ID: optional,
  POLAR_ENTERPRISE_PRODUCT_ID: optional,

  // Railway
  RAILWAY_API_URL: optional,
  RAILWAY_API_TOKEN: optional,
  RAILWAY_PROJECT_ID: optional,
  RAILWAY_ENVIRONMENT_ID: optional,
  RAILWAY_DEFAULT_REGION: z.string().default("us-east4-eqdc4a"),
  PUBLIC_RAILWAY_DOMAINS: boolWithDefault(false),

  // Tunnel
  TUNNEL_JWT_SECRET: optional,
  AGENT_JWT_SECRET: optional,
  WORKSPACE_JWT_SECRET: optional,

  // Routing
  ROUTING_MODE: routingMode,

  // Discord (optional unless ENABLE_DISCORD_NOTIFICATIONS is true)
  DISCORD_TOKEN: optional,
  DISCORD_DM_CHANNEL_ID: optional,

  // Feature flags
  ENABLE_BILLING: boolWithDefault(false),
  ENABLE_QUOTA_ENFORCEMENT: boolWithDefault(false),
  ENABLE_IDLE_REAPING: boolWithDefault(true),
  ENABLE_USAGE_METERING: boolWithDefault(false),
  ENABLE_DISCORD_NOTIFICATIONS: boolWithDefault(false),
  ENABLE_MULTI_REGION: boolWithDefault(false),
  ENABLE_CUSTOM_SUBDOMAINS: boolWithDefault(true),
  ENABLE_LOCAL_TUNNELS: boolWithDefault(true),
  ENABLE_GITHUB_AUTH: boolWithDefault(false),
  ENABLE_EMAIL_AUTH: boolWithDefault(true),
// ... keep the z.object({ ... }) as-is ...
}).superRefine((data, ctx) => {
  const errors: { path: string; message: string }[] = [];

  // Managed mode requires Polar billing configuration
  if (data.DEPLOYMENT_MODE === "managed") {
    if (!data.POLAR_ACCESS_TOKEN) {
      errors.push({ path: "POLAR_ACCESS_TOKEN", message: "POLAR_ACCESS_TOKEN is required in managed mode" });
    }
    if (!data.POLAR_WEBHOOK_SECRET) {
      errors.push({ path: "POLAR_WEBHOOK_SECRET", message: "POLAR_WEBHOOK_SECRET is required in managed mode" });
    }
    if (!data.POLAR_TUNNEL_PRODUCT_ID) {
      errors.push({ path: "POLAR_TUNNEL_PRODUCT_ID", message: "POLAR_TUNNEL_PRODUCT_ID is required in managed mode" });
    }
    if (!data.POLAR_PRO_PRODUCT_ID) {
      errors.push({ path: "POLAR_PRO_PRODUCT_ID", message: "POLAR_PRO_PRODUCT_ID is required in managed mode" });
    }
    if (!data.POLAR_ENTERPRISE_PRODUCT_ID) {
      errors.push({ path: "POLAR_ENTERPRISE_PRODUCT_ID", message: "POLAR_ENTERPRISE_PRODUCT_ID is required in managed mode" });
    }
  }

  // Railway provider requires Railway configuration
  if (data.ENABLED_PROVIDERS.includes("railway")) {
    if (!data.RAILWAY_API_TOKEN) {
      errors.push({ path: "RAILWAY_API_TOKEN", message: "RAILWAY_API_TOKEN is required when Railway provider is enabled" });
    }
    if (!data.RAILWAY_PROJECT_ID) {
      errors.push({ path: "RAILWAY_PROJECT_ID", message: "RAILWAY_PROJECT_ID is required when Railway provider is enabled" });
    }
    if (!data.RAILWAY_ENVIRONMENT_ID) {
      errors.push({ path: "RAILWAY_ENVIRONMENT_ID", message: "RAILWAY_ENVIRONMENT_ID is required when Railway provider is enabled" });
    }
  }

  // Discord notifications require Discord configuration
  if (data.ENABLE_DISCORD_NOTIFICATIONS) {
    if (!data.DISCORD_TOKEN) {
      errors.push({ path: "DISCORD_TOKEN", message: "DISCORD_TOKEN is required when ENABLE_DISCORD_NOTIFICATIONS is true" });
    }
    if (!data.DISCORD_DM_CHANNEL_ID) {
      errors.push({ path: "DISCORD_DM_CHANNEL_ID", message: "DISCORD_DM_CHANNEL_ID is required when ENABLE_DISCORD_NOTIFICATIONS is true" });
    }
  }

  // GitHub App integration: either both or neither
  const hasAppId = !!data.GITHUB_APP_ID;
  const hasPrivateKey = !!data.GITHUB_APP_PRIVATE_KEY;
  if ((hasAppId && !hasPrivateKey) || (!hasAppId && hasPrivateKey)) {
    errors.push({ path: "GITHUB_APP_ID", message: "Both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set together (or neither)" });
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
export const isProviderEnabled = (p: string) => env.ENABLED_PROVIDERS.includes(p);
export const isBillingEnabled = () => env.ENABLE_BILLING || (isManaged() && !!env.POLAR_ACCESS_TOKEN);
export const isGitHubAuthEnabled = () => env.ENABLE_GITHUB_AUTH || !!env.GITHUB_CLIENT_ID;
export const isSubdomainRouting = () => env.ROUTING_MODE === "subdomain";
export const isPathRouting = () => env.ROUTING_MODE === "path";

export { baseSchema as serverEnvSchema };

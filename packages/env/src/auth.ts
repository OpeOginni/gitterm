/**
 * Auth Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/auth';
 */

import {
  z,
  parseEnv,
  deploymentMode,
  polarEnvironment,
  optional,
  boolWithDefault,
  nodeEnv,
} from "./index";

const schema = z.object({
  NODE_ENV: nodeEnv,
  RAILWAY_ENVIRONMENT: optional,

  DEPLOYMENT_MODE: deploymentMode,
  BASE_DOMAIN: z.string().default("gitterm.dev"),

  // Auth
  BETTER_AUTH_SECRET: optional, // Will fail at runtime if not set
  BETTER_AUTH_URL: optional,
  CORS_ORIGIN: optional,

  // GitHub
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  ENABLE_GITHUB_AUTH: boolWithDefault(false),

  // Polar
  POLAR_ACCESS_TOKEN: optional,
  POLAR_WEBHOOK_SECRET: optional,
  POLAR_ENVIRONMENT: polarEnvironment,
  POLAR_TUNNEL_PRODUCT_ID: optional,
  POLAR_PRO_PRODUCT_ID: optional,

  ENABLE_BILLING: boolWithDefault(false),
  
  // Auth cookie configuration
  // Set to true when web and server are on different domains (e.g., separate Railway services)
  // Default false assumes same domain (behind Caddy/reverse proxy)
  SPLIT_DOMAIN_AUTH: boolWithDefault(false),
});

export type AuthEnv = z.infer<typeof schema>;

const env = parseEnv(schema);
export default env;

export const isManaged = () => env.DEPLOYMENT_MODE === "managed";
export const isProduction = () =>
  env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT === "production";
export const isBillingEnabled = () =>
  (env.ENABLE_BILLING || isManaged()) && !!env.POLAR_ACCESS_TOKEN;
export const isGitHubAuthEnabled = () => env.ENABLE_GITHUB_AUTH;
export const isSplitDomainAuth = () => env.SPLIT_DOMAIN_AUTH;

export { schema as authEnvSchema };

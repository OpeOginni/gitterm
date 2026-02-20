/**
 * Web Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/web';
 */

import { z, parseEnv, optional, nodeEnv, boolWithDefault, routingMode } from "./index";

const schema = z.object({
  NODE_ENV: nodeEnv,

  NEXT_PUBLIC_ENABLE_BILLING: boolWithDefault(false),
  NEXT_PUBLIC_ENABLE_EMAIL_AUTH: boolWithDefault(false),
  NEXT_PUBLIC_ENABLE_GITHUB_AUTH: boolWithDefault(true),
  NEXT_PUBLIC_BASE_DOMAIN: z.string().default("gitterm.dev"),
  NEXT_PUBLIC_ROUTING_MODE: routingMode,
  NEXT_PUBLIC_SERVER_URL: optional,
  NEXT_PUBLIC_AUTH_URL: optional,
  NEXT_PUBLIC_LISTENER_URL: optional,
  NEXT_PUBLIC_GITHUB_APP_NAME: optional,
});

export type WebEnv = z.infer<typeof schema>;

// IMPORTANT (Next.js):
// In the browser bundle, Next only inlines env vars when accessed directly via
// `process.env.NEXT_PUBLIC_*`. Iterating/reading the whole `process.env` object
// will not include these keys. Build an explicit env object so values are inlined.
const rawEnv: Record<string, string | undefined> = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_ENABLE_BILLING: process.env.NEXT_PUBLIC_ENABLE_BILLING,
  NEXT_PUBLIC_ENABLE_EMAIL_AUTH: process.env.NEXT_PUBLIC_ENABLE_EMAIL_AUTH,
  NEXT_PUBLIC_ENABLE_GITHUB_AUTH: process.env.NEXT_PUBLIC_ENABLE_GITHUB_AUTH,
  NEXT_PUBLIC_BASE_DOMAIN: process.env.NEXT_PUBLIC_BASE_DOMAIN,
  NEXT_PUBLIC_ROUTING_MODE: process.env.NEXT_PUBLIC_ROUTING_MODE,
  NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
  NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
  NEXT_PUBLIC_LISTENER_URL: process.env.NEXT_PUBLIC_LISTENER_URL,
  NEXT_PUBLIC_GITHUB_APP_NAME: process.env.NEXT_PUBLIC_GITHUB_APP_NAME,
};

const env = parseEnv(schema, rawEnv);
export default env;

export const isBillingEnabled = () => env.NEXT_PUBLIC_ENABLE_BILLING;
export const isEmailAuthEnabled = () => env.NEXT_PUBLIC_ENABLE_EMAIL_AUTH;
export const isGitHubAuthEnabled = () => env.NEXT_PUBLIC_ENABLE_GITHUB_AUTH;

export { schema as webEnvSchema };

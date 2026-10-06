import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@gitterm/db";
import * as schema from "@gitterm/db/schema/auth";
import { nextCookies } from "better-auth/next-js";
import env, {
  isManaged,
  isProduction,
  isGitHubAuthEnabled,
  getGitHubAuthCredentials,
} from "@gitterm/env/auth";

// ============================================================================
// Environment Configuration
// ============================================================================

const SUBDOMAIN_DOMAIN = `.${env.BASE_DOMAIN}`;
const AUTH_BASE_PATH = "/api/auth";
const githubAuthCredentials = getGitHubAuthCredentials();

function inferBaseUrlOrigin(): string {
  // If explicitly configured, trust it (but normalize to origin so better-auth can append basePath cleanly)
  if (env.BETTER_AUTH_URL) {
    try {
      return new URL(env.BETTER_AUTH_URL).origin;
    } catch {
      // fall through to BASE_DOMAIN-based inference
    }
  }

  // Derive from BASE_DOMAIN (supports localhost:8888 in local dev)
  const isLocal = env.BASE_DOMAIN.includes("localhost") || env.BASE_DOMAIN.includes("127.0.0.1");
  return `${isLocal ? "http" : "https"}://${env.BASE_DOMAIN}`;
}

// Managed deployments add billing's Polar plugins; other deployments never load billing.
const billingPlugins = isManaged()
  ? (await import("@gitterm/billing/auth")).createBillingAuthPlugins()
  : [];

// ============================================================================
// Better Auth Configuration
// ============================================================================

export const auth = betterAuth({
  // IMPORTANT:
  // Ensure better-auth's internal router basePath is stable and not accidentally
  // derived from env.BASE_URL (which might include "/api" in local dev).
  baseURL: inferBaseUrlOrigin(),
  basePath: AUTH_BASE_PATH,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  trustedOrigins: env.CORS_ORIGIN ? [env.CORS_ORIGIN] : undefined,
  onAPIError: {
    errorURL: `${(env.CORS_ORIGIN || inferBaseUrlOrigin()).replace(/\/$/, "")}/login`,
  },
  crossSubDomainCookies: isProduction() ? { enabled: true, domain: SUBDOMAIN_DOMAIN } : undefined,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: isGitHubAuthEnabled()
    ? {
        github: {
          clientId: githubAuthCredentials!.clientId,
          clientSecret: githubAuthCredentials!.clientSecret,
        },
      }
    : undefined,
  user: {
    additionalFields: {
      role: {
        type: ["user", "admin"],
        required: false,
        defaultValue: "user",
        input: false, // don't allow user to set role
      },
    },
  },
  advanced: {
    defaultCookieAttributes: isProduction()
      ? {
          secure: true,
          httpOnly: true,
          sameSite: "none",
          partitioned: true,
          domain: SUBDOMAIN_DOMAIN,
        }
      : {
          sameSite: "lax",
          secure: false,
          httpOnly: true,
        },
  },
  plugins: [
    ...billingPlugins,
    // nextCookies must be last
    nextCookies(),
  ],
});

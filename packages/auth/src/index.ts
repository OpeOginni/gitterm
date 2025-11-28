import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@gitpad/db";
import * as schema from "@gitpad/db/schema/auth";

const BASE_DOMAIN = process.env.BASE_DOMAIN || "gitterm.dev";
const SUBDOMAIN_DOMAIN = `.${BASE_DOMAIN}`;
const isProduction = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT === "production";

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	trustedOrigins: process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : undefined,
	crossSubDomainCookies: isProduction
		? {
				enabled: true,
				domain: SUBDOMAIN_DOMAIN, // .gitterm.dev
			}
		: undefined,
	emailAndPassword: {
		enabled: true,
	},
	advanced: {
		defaultCookieAttributes: isProduction
			? {
					secure: true,
					httpOnly: true,
					sameSite: "none", // Allows CORS-based cookie sharing across subdomains
					partitioned: true, // New browser standards will mandate this for foreign cookies
					domain: SUBDOMAIN_DOMAIN, // Set cookie domain for subdomain sharing
				}
			: {
					sameSite: "lax",
					secure: false,
					httpOnly: true,
				},
	},
} as BetterAuthOptions);

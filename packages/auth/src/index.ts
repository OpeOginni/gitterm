import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@gitpad/db";
import * as schema from "@gitpad/db/schema/auth";
import { nextCookies } from "better-auth/next-js";
import { Client } from "discord.js";

const BASE_DOMAIN = process.env.BASE_DOMAIN || "gitterm.dev";
const SUBDOMAIN_DOMAIN = `.${BASE_DOMAIN}`;
const isProduction = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT === "production";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_DM_CHANNEL_ID = process.env.DISCORD_DM_CHANNEL_ID;

if (!DISCORD_TOKEN) {
	throw new Error("DISCORD_TOKEN is not set");
}if (!DISCORD_DM_CHANNEL_ID) {
	throw new Error("DISCORD_DM_CHANNEL_ID is not set");
}

const discordClient = new Client({ intents: [] });

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
	socialProviders: {
		github: {
			clientId: process.env.GITHUB_CLIENT_ID as string, 
            clientSecret: process.env.GITHUB_CLIENT_SECRET as string, 
		}
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
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					// This hook fires ONLY when a new user is created (sign-up), not on sign-in
					await discordClient.login(DISCORD_TOKEN);
					const discordUser = await discordClient.users.fetch(DISCORD_DM_CHANNEL_ID);
					discordUser.send(`**New user signed up:**\n\nName: ${user.name}\nEmail: ${user.email}`);
				},
			},
		},
	},
	plugins: [nextCookies()]
} as BetterAuthOptions);

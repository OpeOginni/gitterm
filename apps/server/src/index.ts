import "dotenv/config";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitpad/api/context";
import { appRouter, proxyResolverRouter } from "@gitpad/api/routers/index";
import { auth } from "@gitpad/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: (origin) => {
			if (!origin) return null;
			const BASE_DOMAIN = process.env.BASE_DOMAIN || "gitterm.dev";
			
			// Allow main web app domain (app.gitterm.dev or gitterm.dev)
			// But NOT workspace subdomains (ws-123.gitterm.dev) - those go through proxy
			const allowedOrigins = [
				`https://${BASE_DOMAIN}`,
				`http://${BASE_DOMAIN}`,
			];
			
			if (origin.includes("localhost")) return origin;
			
			return allowedOrigins.includes(origin) ? origin : null;
		},
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "Cookie"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/internal/proxy-resolve", async (c) => await proxyResolverRouter(c));

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
	}),
);

app.get("/", (c) => {
	return c.text("OK");
});

export default {
	fetch: app.fetch,
	hostname: "::",
	port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
};
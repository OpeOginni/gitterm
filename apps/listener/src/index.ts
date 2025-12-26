import "dotenv/config";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitterm/api/context";
import { listenerRouter } from "@gitterm/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import env from "@gitterm/env/listener";

const app = new Hono();

app.use(logger());

app.use("/*", cors({
    origin: (origin) => {
        if (!origin) return null;
        const BASE_DOMAIN = env.BASE_DOMAIN;
        
        // Allow main web app domain
        const allowedOrigins = [
            `https://${BASE_DOMAIN}`,
            `http://${BASE_DOMAIN}`,
        ];
        
        // Allow localhost for development
        if (origin.includes("localhost")) return origin;
        
        return allowedOrigins.includes(origin) ? origin : null;
    },
	allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowHeaders: ["Content-Type", "Authorization", "Cookie"],
	credentials: true,
}));

app.use(
	"/trpc/*",
	trpcServer({
		router: listenerRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
		onError: (error) => {
			console.error(error);
			return new Response("Sub Error", { status: 500 });
		}
	}),
);

app.get("/health", (c) => {
	return c.text("OK");
});

app.get("/", (c) => {
	return c.text("OK");
});

export default app;

// export default {
// 	fetch: app.fetch,
// 	port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
// };

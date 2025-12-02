import "dotenv/config";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitpad/api/context";
import { listenerRouter } from "@gitpad/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());

console.log("CORS_ORIGIN", process.env.CORS_ORIGIN);

app.use("/*", cors({
    // origin: process.env.CORS_ORIGIN ?? "*",
	origin: ["https://gitterm.dev", "http://localhost:3001"],
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
		},
	}),
);

app.get("/health", (c) => {
	return c.text("OK");
});

app.get("/", (c) => {
	return c.text("OK");
});

export default app;

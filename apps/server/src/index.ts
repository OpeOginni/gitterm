import "dotenv/config";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitpad/api/context";
import { appRouter, proxyResolverRouter } from "@gitpad/api/routers/index";
import { auth } from "@gitpad/auth";
import { DeviceCodeService } from "@gitpad/api/service/tunnel/device-code";
import { AgentAuthService } from "@gitpad/api/service/tunnel/agent-auth";
import { DeviceCodeRepository } from "@gitpad/redis";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();
const deviceCodeService = new DeviceCodeService();
const agentAuthService = new AgentAuthService();
const deviceRepo = new DeviceCodeRepository();

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

// Device code flow for CLI/agent login.
app.post("/api/device/code", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { clientName?: string };
	return c.json(await deviceCodeService.startDeviceLogin({ clientName: body.clientName }));
});

app.post("/api/device/token", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { deviceCode?: string };
	if (!body.deviceCode) return c.json({ error: "invalid_request" }, 400);

	const result = await agentAuthService.exchangeDeviceCode(body.deviceCode);
	if (!result) return c.json({ error: "authorization_pending" }, 428);

	return c.json({ accessToken: result.agentToken, tokenType: "Bearer", expiresInSeconds: 30 * 24 * 60 * 60 });
});

app.post("/api/device/approve", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as { userCode?: string; action?: "approve" | "deny" };
	if (!body.userCode) return c.json({ error: "invalid_request" }, 400);

	if (body.action === "deny") {
		await deviceRepo.deny({ userCode: body.userCode });
		return c.json({ ok: true });
	}

	await deviceRepo.approve({ userCode: body.userCode, userId: session.user.id });
	return c.json({ ok: true });
});

app.post("/api/agent/tunnel-token", async (c) => {
	const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
	if (!token) return c.json({ error: "unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as { workspaceId?: string };
	if (!body.workspaceId) return c.json({ error: "invalid_request" }, 400);

	try {
		const result = await agentAuthService.mintTunnelToken({ agentToken: token, workspaceId: body.workspaceId });
		return c.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Internal error";
		if (message.toLowerCase().includes("unauthorized")) return c.json({ error: "unauthorized" }, 401);
		if (message.toLowerCase().includes("forbidden")) return c.json({ error: "forbidden" }, 403);
		if (message.toLowerCase().includes("not found")) return c.json({ error: "not_found" }, 404);
		return c.json({ error: "internal_error" }, 500);
	}
});

app.post("/api/agent/workspace-ports", async (c) => {
	const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
	if (!token) return c.json({ error: "unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as {
		workspaceId?: string;
		localPort?: number;
		exposedPorts?: Record<string, { port: number; description?: string }>;
	};
	if (!body.workspaceId || !body.localPort) return c.json({ error: "invalid_request" }, 400);

	try {
		const result = await agentAuthService.updateWorkspacePorts({
			agentToken: token,
			workspaceId: body.workspaceId,
			localPort: body.localPort,
			exposedPorts: body.exposedPorts ?? {},
		});
		return c.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Internal error";
		if (message.toLowerCase().includes("unauthorized")) return c.json({ error: "unauthorized" }, 401);
		if (message.toLowerCase().includes("forbidden")) return c.json({ error: "forbidden" }, 403);
		if (message.toLowerCase().includes("not found")) return c.json({ error: "not_found" }, 404);
		return c.json({ error: "internal_error" }, 500);
	}
});

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
	}),
);


app.get("/internal/proxy-resolve", async (c) => await proxyResolverRouter(c));


app.get("/", (c) => {
	return c.text("OK");
});

export default {
	fetch: app.fetch,
	hostname: "::",
	port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
};
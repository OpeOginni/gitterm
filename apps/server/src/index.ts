import "dotenv/config";
import env from "@gitterm/env/server";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@gitterm/api/context";
import { appRouter, proxyResolverRouter } from "@gitterm/api/routers/index";
import { auth } from "@gitterm/auth";
import { DeviceCodeService } from "@gitterm/api/service/tunnel/device-code";
import { AgentAuthService } from "@gitterm/api/service/tunnel/agent-auth";
import { getGitHubAppService } from "@gitterm/api/service/github";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@gitterm/api/routers/index";

function getPublicOriginFromRequest(req: Request): string {
	// Prefer proxy headers (Caddy / reverse proxies)
	const xfProto = req.headers.get("x-forwarded-proto");
	const xfHost = req.headers.get("x-forwarded-host");
	if (xfProto && xfHost) return `${xfProto}://${xfHost}`;

	// Fallback to request URL origin
	return new URL(req.url).origin;
}

function getTunnelOriginFromRequest(req: Request): string {
	// Prefer explicit tunnel URL if configured (managed/prod commonly uses a separate tunnel host)
	if (env.TUNNEL_PUBLIC_URL) {
		try {
			return new URL(env.TUNNEL_PUBLIC_URL).origin;
		} catch {
			// fall back
		}
	}

	// Otherwise derive from the public origin (self-hosted proxy often serves /tunnel/* on the same host)
	return getPublicOriginFromRequest(req);
}


function toTunnelWsUrl(origin: string): string {
	const u = new URL(origin);
	u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
	u.pathname = "/tunnel/connect";
	u.search = "";
	u.hash = "";
	return u.toString();
}

const app = new Hono();
const deviceCodeService = new DeviceCodeService();
const agentAuthService = new AgentAuthService();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: (origin) => {
			if (!origin) return null;
			
			// Allow main web app domain (app.gitterm.dev or gitterm.dev)
			// But NOT workspace subdomains (ws-123.gitterm.dev) - those go through proxy
			const allowedOrigins = [
				`https://${env.BASE_DOMAIN}`,
				`http://${env.BASE_DOMAIN}`,
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

// GitHub App Installation callback
// Called after user installs/updates the GitHub App
app.get("/api/github/callback", async (c) => {
	const webUrl = env.BASE_URL || `http://${env.BASE_DOMAIN}`;
	
	try {
		// Get session from auth
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		
		if (!session) {
			return c.redirect(`${webUrl}/login?returnTo=/dashboard/integrations`);
		}

		const installationId = c.req.query("installation_id");
		const setupAction = c.req.query("setup_action") || "install";

		if (!installationId) {
			console.error("[GitHub Setup] Missing installation_id parameter");
			return c.redirect(`${webUrl}/dashboard/integrations?error=missing_installation_id`);
		}

		console.log("[GitHub Setup] Received callback:", {
			userId: session.user.id,
			installationId,
			setupAction,
		});

		try {
			const githubAppService = getGitHubAppService();
			
			// Get installation details from GitHub
			const installationData = await githubAppService.getInstallationDetails(installationId);

			// Store installation in database
			await githubAppService.storeInstallation({
				userId: session.user.id,
				installationId,
				accountId: installationData.account.id.toString(),
				accountLogin: installationData.account.login,
				accountType: installationData.account.type,
				repositorySelection: installationData.repositorySelection,
			});

			console.log("[GitHub Setup] Installation saved successfully:", {
				userId: session.user.id,
				installationId,
				accountLogin: installationData.account.login,
			});

			return c.redirect(`${webUrl}/dashboard/integrations?success=github_connected`);
		} catch (error) {
			console.error("[GitHub Setup] Failed to handle installation:", error);
			return c.redirect(`${webUrl}/dashboard/integrations?error=installation_failed`);
		}
	} catch (error) {
		console.error("[GitHub Setup] Callback error:", error);
		return c.redirect(`${webUrl}/dashboard/integrations?error=callback_failed`);
	}
});

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

// Device approval is now handled via tRPC: trpc.device.approve

app.post("/api/agent/tunnel-token", async (c) => {
	const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
	if (!token) return c.json({ error: "unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as { workspaceId?: string };
	if (!body.workspaceId) return c.json({ error: "invalid_request" }, 400);

	try {
		const result = await agentAuthService.mintTunnelToken({ agentToken: token, workspaceId: body.workspaceId });
		const publicOrigin = getPublicOriginFromRequest(c.req.raw);
		const tunnelOrigin = getTunnelOriginFromRequest(c.req.raw);

		return c.json({
			...result,
			connect: {
				// Agent expects an origin (it appends `/api/...` internally).
				serverUrl: publicOrigin,
				// Agent websocket connect URL.
				wsUrl: toTunnelWsUrl(tunnelOrigin),
				
				// Help the agent render workspace/service URLs correctly.
				routingMode: env.ROUTING_MODE,
				baseDomain: env.BASE_DOMAIN,
			},
		});
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


app.get("/api/internal/proxy-resolve", async (c) => await proxyResolverRouter(c));


app.get("/", (c) => {
	return c.text("OK");
});

app.get("/api/health", (c) => {
	return c.json({ status: "healthy" });
});

export default {
	fetch: app.fetch,
	hostname: "::",
	port: env.PORT,
};
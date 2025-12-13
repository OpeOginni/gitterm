import "dotenv/config";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { TunnelRepository } from "@gitpad/redis";
import { ConnectionManager } from "./connection-manager";
import { tunnelFrameSchema, type TunnelFrame } from "./protocol";
import { tunnelJWT } from "./tunnel-jwt";

const app = new Hono();
const tunnelRepo = new TunnelRepository();
const connectionManager = new ConnectionManager();

function sendJson(ws: { send: (data: string) => void }, frame: TunnelFrame) {
	ws.send(JSON.stringify(frame));
}

function base64ToBytes(data: string): Uint8Array {
	return new Uint8Array(Buffer.from(data, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

app.get("/health", (c) => c.json({ status: "ok" }));

// WS endpoint for agents.
// Auth via first `auth` frame with tunnel JWT.
app.get(
	"/tunnel/connect",
	upgradeWebSocket((_c) => {
		let authedSubdomain: string | null = null;

		return {
			onOpen: (_evt, ws) => {
				console.log("[TUNNEL-PROXY] WebSocket connection opened");
				// Tell agent to authenticate.
				sendJson(ws, { type: "open", id: crypto.randomUUID(), timestamp: Date.now() });
			},
			onMessage: async (evt, ws) => {
				if (typeof evt.data !== "string") return;
				if (authedSubdomain) connectionManager.markSeen(authedSubdomain);
				let parsed: unknown;
				try {
					parsed = JSON.parse(evt.data);
				} catch {
					return;
				}
				const result = tunnelFrameSchema.safeParse(parsed);
				if (!result.success) return;
				const frame = result.data;

				// First message must be auth.
				if (!authedSubdomain) {
					console.log("[TUNNEL-PROXY] Received auth attempt");
					if (frame.type !== "auth" || !frame.token) {
						console.log("[TUNNEL-PROXY] Auth failed: invalid frame");
						sendJson(ws, {
							type: "error",
							id: crypto.randomUUID(),
							timestamp: Date.now(),
							headers: { reason: "unauthorized" },
						});
						ws.close(1008, "Unauthorized");
						return;
					}

					let claims: { workspaceId: string; userId: string; subdomain: string } | null = null;
					let tokenPayload: ReturnType<typeof tunnelJWT.verifyToken> | null = null;
					try {
						const payload = tunnelJWT.verifyToken(frame.token);
						if (!tunnelJWT.hasScope(payload, "tunnel:connect")) {
							throw new Error("missing scope");
						}
						claims = { workspaceId: payload.workspaceId, userId: payload.userId, subdomain: payload.subdomain };
						tokenPayload = payload;
					} catch (error) {
						console.log("[TUNNEL-PROXY] Token verification failed:", error);
						claims = null;
						tokenPayload = null;
					}

					if (!claims?.workspaceId || !claims.userId || !claims.subdomain) {
						console.log("[TUNNEL-PROXY] Auth failed: invalid claims");
						sendJson(ws, {
							type: "error",
							id: crypto.randomUUID(),
							timestamp: Date.now(),
							headers: { reason: "unauthorized" },
						});
						ws.close(1008, "Unauthorized");
						return;
					}

					const allowlist = tokenPayload?.exposedPorts ?? {};
					const requestedPrimaryPort = frame.port;
					const requestedExposedPorts = frame.exposedPorts ?? {};

					const primaryPort = allowlist.root;
					if (!primaryPort || !requestedPrimaryPort || requestedPrimaryPort !== primaryPort) {
						console.log("[TUNNEL-PROXY] Auth failed: primary port mismatch", { allowlist, requestedPrimaryPort });
						sendJson(ws, {
							type: "error",
							id: crypto.randomUUID(),
							timestamp: Date.now(),
							headers: { reason: "bad_request", message: "primary port not allowed" },
						});
						ws.close(1008, "Bad Request");
						return;
					}

					// Validate service ports from token allowlist.
					const tokenServicePorts: Record<string, number> = Object.fromEntries(
						Object.entries(allowlist)
							.filter(([name]) => name !== "root")
							.map(([name, port]) => [name, port]),
					);

					const allowlistedKeys = new Set(Object.keys(tokenServicePorts));
					for (const requestedServiceName of Object.keys(requestedExposedPorts)) {
						if (!allowlistedKeys.has(requestedServiceName)) {
							console.log("[TUNNEL-PROXY] Auth failed: service not allowed", requestedServiceName);
							sendJson(ws, {
								type: "error",
								id: crypto.randomUUID(),
								timestamp: Date.now(),
								headers: { reason: "bad_request", message: `service not allowed: ${requestedServiceName}` },
							});
							ws.close(1008, "Bad Request");
							return;
						}
						if (requestedExposedPorts[requestedServiceName] !== tokenServicePorts[requestedServiceName]) {
							console.log("[TUNNEL-PROXY] Auth failed: port mismatch for service", requestedServiceName);
							sendJson(ws, {
								type: "error",
								id: crypto.randomUUID(),
								timestamp: Date.now(),
								headers: { reason: "bad_request", message: `port not allowed for ${requestedServiceName}` },
							});
							ws.close(1008, "Bad Request");
							return;
						}
					}

					authedSubdomain = claims.subdomain;
					console.log("[TUNNEL-PROXY] Agent authenticated successfully:", { 
						subdomain: claims.subdomain, 
						workspaceId: claims.workspaceId,
						primaryPort 
					});
					await connectionManager.register({
						subdomain: claims.subdomain,
						workspaceId: claims.workspaceId,
						userId: claims.userId,
						primaryPort,
						exposedPorts: tokenServicePorts,
						ws: ws.raw,
					});

					sendJson(ws, { type: "auth", id: frame.id, timestamp: Date.now() });
					return;
				}

				// After auth, handle frames.
				if (frame.type === "ping") {
					await connectionManager.heartbeat(authedSubdomain);
					sendJson(ws, { type: "pong", id: frame.id, timestamp: Date.now() });
					return;
				}

				if (frame.type === "pong") {
					connectionManager.markSeen(authedSubdomain);
					return;
				}

				const agent = connectionManager.get(authedSubdomain);
				if (!agent) return;

				if (frame.type === "response") {
					console.log("[TUNNEL-PROXY] Received response frame from agent:", { 
						requestId: frame.id, 
						statusCode: frame.statusCode,
						subdomain: authedSubdomain 
					});
					agent.mux.resolveResponse(frame.id, {
						status: frame.statusCode ?? 502,
						headers: frame.headers,
					});
					return;
				}

				if (frame.type === "data") {
					console.log("[TUNNEL-PROXY] Received data frame from agent:", { 
						requestId: frame.id, 
						dataLength: frame.data?.length ?? 0,
						final: frame.final,
						subdomain: authedSubdomain 
					});
					const bytes = frame.data ? base64ToBytes(frame.data) : new Uint8Array();
					agent.mux.pushData(frame.id, bytes, frame.final ?? false);
				}
			},
			onClose: async () => {
				if (authedSubdomain) await connectionManager.unregister(authedSubdomain);
			},
			onError: async () => {
				if (authedSubdomain) await connectionManager.unregister(authedSubdomain);
			},
		};
	}),
);

// HTTP handler for local tunnel traffic from Caddy.
// Caddy passes `Host` and `X-Subdomain` headers.
app.all("/*", async (c) => {
	if (c.req.path === "/health" || c.req.path.startsWith("/tunnel/")) {
		return c.notFound();
	}

	const host = c.req.header("host") || "";
	const fullSubdomain = host.split(":")[0]?.split(".")[0] || "";
	console.log("[TUNNEL-PROXY] Incoming HTTP request:", { 
		host, 
		fullSubdomain, 
		path: c.req.path,
		method: c.req.method,
		headers: {
			"x-subdomain": c.req.header("x-subdomain"),
			"x-tunnel-type": c.req.header("x-tunnel-type"),
			"x-workspace-id": c.req.header("x-workspace-id"),
		}
	});
	
	if (!fullSubdomain) {
		console.log("[TUNNEL-PROXY] Bad request: no subdomain");
		return c.text("Bad Request", 400);
	}

	// Optional header from Caddy forward_auth; helps prevent Host spoofing.
	const expectedBase = c.req.header("x-subdomain") || "";

	// Resolve which port is being requested (primary or service mapping).
	const targetPort = await tunnelRepo.getServicePort(fullSubdomain);
	console.log("[TUNNEL-PROXY] Port lookup:", { fullSubdomain, targetPort });
	if (!targetPort) {
		console.log("[TUNNEL-PROXY] 503 - No port mapping found in Redis");
		return c.text("Tunnel Offline", 503);
	}

	// Resolve agent by base subdomain (service subdomains may contain dashes).
	const baseSubdomain = (await tunnelRepo.getServiceBase(fullSubdomain)) ?? fullSubdomain;
	console.log("[TUNNEL-PROXY] Subdomain resolution:", { fullSubdomain, baseSubdomain, expectedBase });

	// If auth layer already resolved a workspace subdomain, enforce it.
	if (expectedBase && expectedBase !== baseSubdomain) {
		console.log("[TUNNEL-PROXY] Bad request: subdomain mismatch");
		return c.text("Bad Request", 400);
	}

	const agent = connectionManager.get(baseSubdomain);
	console.log("[TUNNEL-PROXY] Agent lookup:", { baseSubdomain, agentFound: !!agent });
	if (!agent) {
		console.log("[TUNNEL-PROXY] 503 - Agent not connected");
		return c.text("Tunnel Offline", 503);
	}

	const requestId = agent.mux.createRequestId();
	const url = new URL(c.req.url);
	const requestFrame: TunnelFrame = {
		type: "request",
		id: requestId,
		method: c.req.method,
		path: c.req.path + (url.search || ""),
		headers: Object.fromEntries(c.req.raw.headers.entries()),
		port: targetPort,
		serviceName: fullSubdomain === baseSubdomain ? undefined : fullSubdomain.slice(baseSubdomain.length + 1),
		timestamp: Date.now(),
	};

	console.log("[TUNNEL-PROXY] Forwarding request to agent:", { 
		requestId, 
		method: c.req.method, 
		path: requestFrame.path,
		subdomain: baseSubdomain 
	});
	agent.ws.send(JSON.stringify(requestFrame));

	// Stream request body to agent.
	if (c.req.raw.body) {
		const reader = c.req.raw.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const dataFrame: TunnelFrame = {
				type: "data",
				id: requestId,
				data: bytesToBase64(value),
				final: false,
				timestamp: Date.now(),
			};
			agent.ws.send(JSON.stringify(dataFrame));
		}
	}
	agent.ws.send(JSON.stringify({ type: "data", id: requestId, final: true, timestamp: Date.now() } satisfies TunnelFrame));

	console.log("[TUNNEL-PROXY] Waiting for response from agent...", { requestId });
	try {
		const res = await agent.mux.register(requestId, 30_000);
		console.log("[TUNNEL-PROXY] Response received from agent:", { 
			requestId, 
			status: res.status,
			headers: Object.fromEntries(res.headers.entries()),
			bodyExists: !!res.body,
			bodyUsed: res.bodyUsed
		});
		return res;
	} catch (error) {
		console.error("[TUNNEL-PROXY] Request timeout or error:", { requestId, error });
		return c.json(
			{
				error: "tunnel_timeout",
				message: error instanceof Error ? error.message : "unknown error",
			},
			504,
		);
	}
});

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 9000;

Bun.serve({
	port,
	fetch: (req, server) => app.fetch(req, { server }),
	websocket,
});

console.log(`tunnel-proxy listening on :${port}`);

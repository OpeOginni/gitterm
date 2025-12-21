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

// WS endpoint for agents..
// Auth via first `auth` frame with tunnel JWT.
app.get(
	"/tunnel/connect",
	upgradeWebSocket((_c) => {
		let authedSubdomain: string | null = null;

		return {
			onOpen: (_evt, ws) => {
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
					if (frame.type !== "auth" || !frame.token) {
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
					claims = null;
					tokenPayload = null;
				}

				if (!claims?.workspaceId || !claims.userId || !claims.subdomain) {
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
					await connectionManager.register({
						subdomain: claims.subdomain,
						workspaceId: claims.workspaceId,
						userId: claims.userId,
						primaryPort,
						exposedPorts: tokenServicePorts,
						ws: ws.raw,
					});

					sendJson(ws, { type: "auth", id: frame.id, timestamp: Date.now(), mainSubdomain: claims.subdomain });

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
				agent.mux.resolveResponse(frame.id, {
					status: frame.statusCode ?? 502,
					headers: frame.headers,
				});
				return;
			}

				if (frame.type === "data") {
					const bytes = frame.data ? base64ToBytes(frame.data) : new Uint8Array();
					agent.mux.pushData(frame.id, bytes, frame.final ?? false);
				}
			},
			onClose: async () => {
				if (authedSubdomain) await connectionManager.unregister(authedSubdomain);
			},
			onError: async (error) => {
				console.error("[TUNNEL-PROXY] Agent WebSocket error:", {
					subdomain: authedSubdomain,
					error: error instanceof Error ? error.message : error,
				});
				if (authedSubdomain) await connectionManager.unregister(authedSubdomain);
			},
		};
	}),
);

// HTTP handler for local tunnel traffic from Caddy.
// Caddy passes `Host` and `X-Subdomain` headers.
app.all("/*", async (c) => {
	try {
	if (c.req.path === "/health" || c.req.path.startsWith("/tunnel/")) {
		return c.notFound();
	}

	const host = c.req.header("host") || "";
	const fullSubdomain = host.split(":")[0]?.split(".")[0] || "";
	
	if (!fullSubdomain) {
		return c.text("Bad Request", 400);
	}

	// Optional header from Caddy forward_auth; helps prevent Host spoofing.
	const expectedBase = c.req.header("x-subdomain") || "";

	// Resolve which port is being requested (primary or service mapping).
	const targetPort = await tunnelRepo.getServicePort(fullSubdomain);
	if (!targetPort) {
		return new Response("Tunnel Offline", {
			status: 503,
			headers: { "X-Tunnel-Offline": "true" },
		});
	}

	// Resolve agent by base subdomain (service subdomains may contain dashes).
	const baseSubdomain = (await tunnelRepo.getServiceBase(fullSubdomain)) ?? fullSubdomain;

	// If auth layer already resolved a workspace subdomain, enforce it.
	if (expectedBase && expectedBase !== baseSubdomain) {
		return c.text("Bad Request", 400);
	}

	const agent = connectionManager.get(baseSubdomain);
	if (!agent) {
		return new Response("Tunnel Offline", {
			status: 503,
			headers: { "X-Tunnel-Offline": "true" },
		});
	}

	const requestId = agent.mux.createRequestId();
	const url = new URL(c.req.url);
	const requestPath = c.req.path + (url.search || "");
	
	// SSE deduplication: cancel any existing SSE connection for this subdomain+path
	let sseKey: string | undefined;
	if (agent.mux.shouldDedupeSSE(c.req.path)) {
		sseKey = `${baseSubdomain}:${c.req.path}`;
		const cancelledId = agent.mux.cancelExistingSSE(sseKey);
		if (cancelledId) {
			// Send close frame to agent for the old request
			try {
				agent.ws.send(
					JSON.stringify(
						{
							type: "close",
							id: cancelledId,
							timestamp: Date.now(),
						} satisfies TunnelFrame,
					),
				);
			} catch {
				// ignore if websocket is closed
			}
		}
	}
	
	const requestFrame: TunnelFrame = {
		type: "request",
		id: requestId,
		method: c.req.method,
		path: requestPath,
		headers: Object.fromEntries(c.req.raw.headers.entries()),
		port: targetPort,
		serviceName: fullSubdomain === baseSubdomain ? undefined : fullSubdomain.slice(baseSubdomain.length + 1),
		timestamp: Date.now(),
	};

	// Register for response BEFORE sending request to avoid race condition
	// where agent responds before we're ready to receive.
	//
	// NOTE: SSE requests are long-lived; we should not apply a fixed overall timeout
	// (otherwise event streams will die after N seconds). For non-SSE, keep a longer
	// timeout (120s) to handle slow upstream responses.
	const isSSE = agent.mux.shouldDedupeSSE(c.req.path);
	const timeoutMs = isSSE ? null : 120_000;
	const responsePromise = agent.mux.register(
		requestId,
		timeoutMs,
		() => {
			// onCancel: notify agent to stop sending data for this request
			try {
				agent.ws.send(
					JSON.stringify(
						{
							type: "close",
							id: requestId,
							timestamp: Date.now(),
						} satisfies TunnelFrame,
					),
				);
			} catch {
				// ignore if websocket is closed
			}
		},
		sseKey,
	);

	
	// If this is an SSE connection, register it for tracking
	if (sseKey) {
		agent.mux.registerSSE(sseKey, requestId);
	}

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

	try {
		const res = await responsePromise;

		// If this is an SSE response, wrap the stream to inject heartbeats and add anti-buffering headers.
		const contentType = res.headers.get("content-type") || "";
		if (contentType.includes("text/event-stream")) {
			const headers = new Headers(res.headers);
			headers.set("cache-control", "no-cache, no-transform");
			headers.set("connection", "keep-alive");
			headers.set("x-accel-buffering", "no");

			// Wrap the SSE stream with heartbeat injection to prevent proxy timeouts (Cloudflare, etc.)
			// Use 5-second interval to stay well under Cloudflare's ~10s idle timeout
			const heartbeatInterval = 5_000;
			const heartbeatComment = new TextEncoder().encode(": heartbeat\n\n");
			
			const upstreamBody = res.body;
			if (!upstreamBody) {
				return new Response(null, { status: res.status, headers });
			}

			const reader = upstreamBody.getReader();
			let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
			let closed = false;

			// Create a TransformStream to inject heartbeats
			const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
			const writer = writable.getWriter();

			// Send initial heartbeat immediately, then start interval
			(async () => {
				try {
					// Immediate heartbeat to establish the stream
					await writer.write(heartbeatComment);
				} catch {
					// ignore
				}
			})();

			// Start heartbeat timer
			heartbeatTimer = setInterval(async () => {
				if (closed) return;
				try {
					await writer.write(heartbeatComment);
				} catch {
					// Stream may be closed
				}
			}, heartbeatInterval);

			// Pipe upstream data to the transform stream
			(async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							closed = true;
							if (heartbeatTimer) clearInterval(heartbeatTimer);
							await writer.close();
							return;
						}
						if (value) {
							await writer.write(value);
						}
					}
				} catch (error) {
					closed = true;
					if (heartbeatTimer) clearInterval(heartbeatTimer);
					try {
						await writer.abort(error instanceof Error ? error : new Error(String(error)));
					} catch {
						// ignore
					}
				}
			})();

			return new Response(readable, { status: res.status, headers });
		}

		return res;
	} catch (error) {
		console.error("[TUNNEL-PROXY] Request error:", { requestId, error: error instanceof Error ? error.message : error });
		return c.json(
			{
				error: "tunnel_timeout",
				message: error instanceof Error ? error.message : "unknown error",
			},
			504,
		);
	}
	} catch (outerError) {
		console.error("[TUNNEL-PROXY] Unhandled error:", { path: c.req.path, error: outerError instanceof Error ? outerError.message : outerError, stack: outerError instanceof Error ? outerError.stack : undefined });
		return c.json(
			{
				error: "internal_error",
				message: outerError instanceof Error ? outerError.message : "unknown error",
			},
			500,
		);
	}
});

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 9000;

Bun.serve({
	port,
	fetch: (req, server) => app.fetch(req, { server }),
	websocket,
});


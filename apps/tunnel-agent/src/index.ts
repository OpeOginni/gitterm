import "dotenv/config";
import { z } from "zod";

const frameSchema = z.object({
	type: z.enum(["auth", "open", "close", "ping", "pong", "request", "response", "data", "error"]),
	id: z.string(),
	method: z.string().optional(),
	path: z.string().optional(),
	token: z.string().optional(),
	statusCode: z.number().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	port: z.number().optional(),
	exposedPorts: z.record(z.string(), z.number()).optional(),
	serviceName: z.string().optional(),
	data: z.string().optional(),
	final: z.boolean().optional(),
	timestamp: z.number().optional(),
});

type Frame = z.infer<typeof frameSchema>;

function base64ToBytes(data: string): Uint8Array {
	return new Uint8Array(Buffer.from(data, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

const wsUrl = process.env.TUNNEL_PROXY_WS_URL;
if (!wsUrl) {
	throw new Error("TUNNEL_PROXY_WS_URL is required");
}

const token = process.env.TUNNEL_TOKEN;
if (!token) {
	throw new Error("TUNNEL_TOKEN is required");
}

const primaryPort = process.env.TUNNEL_PRIMARY_PORT ? Number.parseInt(process.env.TUNNEL_PRIMARY_PORT, 10) : undefined;
if (!primaryPort) {
	throw new Error("TUNNEL_PRIMARY_PORT is required");
}

const targetBase = process.env.TARGET_BASE_URL ?? "http://localhost:3000";

type PendingRequestMeta = {
	method: string;
	path: string;
	headers: Record<string, string>;
	port?: number;
};

const pendingRequestBodies = new Map<string, Uint8Array[]>();
const pendingRequestMeta = new Map<string, PendingRequestMeta>();

function mergeBody(id: string): Uint8Array {
	const parts = pendingRequestBodies.get(id) ?? [];
	pendingRequestBodies.delete(id);
	if (parts.length === 0) return new Uint8Array();
	const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
	const merged = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		merged.set(p, off);
		off += p.byteLength;
	}
	return merged;
}

const ws = new WebSocket(wsUrl);

ws.addEventListener("open", () => {
	console.log("tunnel-agent connected", { wsUrl, targetBase });
			ws.send(
				JSON.stringify({
					type: "auth",
					id: crypto.randomUUID(),
					token,
					port: primaryPort,
					exposedPorts: {},
					timestamp: Date.now(),
				} satisfies Frame),
			);

});

ws.addEventListener("message", async (event) => {
	if (typeof event.data !== "string") return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(event.data);
	} catch {
		return;
	}

	const result = frameSchema.safeParse(parsed);
	if (!result.success) return;
	const frame = result.data;

	if (frame.type === "ping") {
		ws.send(JSON.stringify({ type: "pong", id: frame.id, timestamp: Date.now() } satisfies Frame));
		return;
	}

	if (frame.type === "pong") {
		return;
	}

	if (frame.type === "auth") {
		// Auth ack from proxy
		return;
	}

	if (frame.type === "request") {
		pendingRequestBodies.set(frame.id, []);
		pendingRequestMeta.set(frame.id, {
			method: (frame.method ?? "GET").toUpperCase(),
			path: frame.path ?? "/",
			headers: frame.headers ?? {},
			port: frame.port,
		});
		return;
	}

	if (frame.type === "data") {
		const chunks = pendingRequestBodies.get(frame.id);
		if (!chunks) return;
		if (frame.data) chunks.push(base64ToBytes(frame.data));
		if (!frame.final) return;

		// Final chunk received, execute upstream fetch.
		try {
			const meta = pendingRequestMeta.get(frame.id);
			if (!meta) return;
			pendingRequestMeta.delete(frame.id);

			const reqBody = mergeBody(frame.id);

			const base = new URL(targetBase.replace(/\/$/, "") + "/");
			if (meta.port) base.port = String(meta.port);

			const url = new URL(meta.path.replace(/^\//, ""), base);

			const headers = new Headers(meta.headers);
			headers.delete("host");
			headers.delete("content-length");

			const upstream = await fetch(url, {
				method: meta.method,
				headers,
				body: reqBody.byteLength > 0 ? reqBody : undefined,
				redirect: "manual",
			});

			ws.send(
				JSON.stringify({
					type: "response",
					id: frame.id,
					statusCode: upstream.status,
					headers: Object.fromEntries(upstream.headers.entries()),
					timestamp: Date.now(),
				} satisfies Frame),
			);

			if (!upstream.body) {
				ws.send(JSON.stringify({ type: "data", id: frame.id, final: true, timestamp: Date.now() } satisfies Frame));
				return;
			}

			const reader = upstream.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				ws.send(
					JSON.stringify({
						type: "data",
						id: frame.id,
						data: bytesToBase64(value),
						final: false,
						timestamp: Date.now(),
					} satisfies Frame),
				);
			}

			ws.send(JSON.stringify({ type: "data", id: frame.id, final: true, timestamp: Date.now() } satisfies Frame));
		} catch (error) {
			pendingRequestMeta.delete(frame.id);
			pendingRequestBodies.delete(frame.id);
			ws.send(
				JSON.stringify({
					type: "response",
					id: frame.id,
					statusCode: 502,
					headers: { "content-type": "application/json" },
					timestamp: Date.now(),
				} satisfies Frame),
			);
			ws.send(
				JSON.stringify({
					type: "data",
					id: frame.id,
					data: bytesToBase64(new TextEncoder().encode(JSON.stringify({ error: "upstream_error" }))),
					final: true,
					timestamp: Date.now(),
				} satisfies Frame),
			);
		}
	}
});

ws.addEventListener("close", () => {
	console.log("tunnel-agent closed");
});

ws.addEventListener("error", (event) => {
	console.error("tunnel-agent error", event);
});

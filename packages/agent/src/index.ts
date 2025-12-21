#!/usr/bin/env node
import { z } from "zod";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";

// Default production URLs
const DEFAULT_WS_URL = "wss://tunnel.gitterm.dev/tunnel/connect";
const DEFAULT_SERVER_URL = "https://api.gitterm.dev";

// const DEFAULT_WS_URL = "ws://localhost:9000/tunnel/connect";
// const DEFAULT_SERVER_URL = "http://localhost:3000";

const usage = `@opeoginni/gitterm-agent

Securely exposes local development ports through your gitterm.dev workspace tunnel.

Usage:
  npx @opeoginni/gitterm-agent <command> [options]

Commands:
  login           Sign in via device-code flow
  logout          Clear saved credentials
  connect         Connect a local port (and optional services)
  help            Show this help

Login options:
  --server-url <url>      Server base URL (default: ${DEFAULT_SERVER_URL})

Connect options:
  --workspace-id <id>     Workspace ID (required)
  --port <number>         Primary local port to expose (required)
  --ws-url <url>          Tunnel-proxy WS URL (default: ${DEFAULT_WS_URL})
  --server-url <url>      Server base URL (default: ${DEFAULT_SERVER_URL})
  --token <jwt>           Tunnel JWT (overrides saved login)
  --expose <name=port>    Expose additional service port (repeatable)

Examples:
  # First time: login to gitterm
  npx @opeoginni/gitterm-agent login

  # Connect a local server to your workspace
  npx @opeoginni/gitterm-agent connect --workspace-id "ws_abc123" --port 3000

  # Expose multiple ports
  npx @opeoginni/gitterm-agent connect --workspace-id "ws_abc123" --port 3000 --expose api=3001

Notes:
  - This tool does not start servers for you.
  - Run your local server first, then connect it to gitterm.
`;

const frameSchema = z.object({
	type: z.enum(["auth", "open", "close", "ping", "pong", "request", "response", "data", "error"]),
	id: z.string(),
	method: z.string().optional(),
	path: z.string().optional(),
	token: z.string().optional(),
	statusCode: z.number().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	port: z.number().optional(),
	serviceName: z.string().optional(),
	exposedPorts: z.record(z.string(), z.number()).optional(),
	mainSubdomain: z.string().optional(),
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

function parseExposeFlags(args: string[]): Record<string, number> {
	const exposed: Record<string, number> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg !== "--expose") continue;
		const value = args[i + 1];
		if (!value) throw new Error("--expose requires a value like name=3001");
		i++;
		const [name, portStr] = value.split("=");
		if (!name || !portStr) throw new Error("--expose requires a value like name=3001");
		const port = Number.parseInt(portStr, 10);
		if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid port for --expose ${value}`);
		exposed[name] = port;
	}
	return exposed;
}

function getFlag(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx === -1) return undefined;
	return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
	return args.includes(flag);
}

type AgentConfig = {
	serverUrl: string;
	agentToken: string;
	createdAt: number;
};

function getConfigPath(): string {
	return join(homedir(), ".config", "gitterm", "agent.json");
}

async function ensureConfigDir() {
	const configPath = getConfigPath();
	await mkdir(dirname(configPath), { recursive: true });
}

async function loadConfig(): Promise<AgentConfig | null> {
	const path = getConfigPath();
	try {
		const text = await readFile(path, "utf-8");
		const parsed = JSON.parse(text) as AgentConfig;
		if (!parsed.agentToken || !parsed.serverUrl) return null;
		return parsed;
	} catch {
		return null;
	}
}

async function saveConfig(config: AgentConfig) {
	await ensureConfigDir();
	await writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

async function deleteConfig() {
	const path = getConfigPath();
	try {
		await unlink(path);
	} catch {
		// ignore if file doesn't exist
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLogin(rawArgs: string[]) {
	const serverUrl = getFlag(rawArgs, "--server-url") ?? DEFAULT_SERVER_URL;

	console.log(`Logging in to gitterm...`);
	
	const codeRes = await fetch(new URL("/api/device/code", serverUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ clientName: "@opeoginni/gitterm-agent" }),
	});
	if (!codeRes.ok) throw new Error(`Failed to start device login: ${codeRes.status}`);

	const codeJson = (await codeRes.json()) as {
		deviceCode: string;
		userCode: string;
		verificationUri: string;
		intervalSeconds: number;
		expiresInSeconds: number;
	};

	console.log("To sign in, visit:");
	console.log(`  ${codeJson.verificationUri}`);
	console.log("And enter code:");
	console.log(`  ${codeJson.userCode}`);

	const deadline = Date.now() + codeJson.expiresInSeconds * 1000;
	while (Date.now() < deadline) {
		const tokenRes = await fetch(new URL("/api/device/token", serverUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ deviceCode: codeJson.deviceCode }),
		});

		if (tokenRes.ok) {
			const tokenJson = (await tokenRes.json()) as { accessToken: string };
			await saveConfig({ serverUrl, agentToken: tokenJson.accessToken, createdAt: Date.now() });
			console.log("Logged in successfully!");
			process.exit(0);
		}

		if (tokenRes.status !== 428) {
			const errText = await tokenRes.text().catch(() => "");
			throw new Error(`Login failed: ${tokenRes.status} ${errText}`);
		}

		await sleep(Math.max(1, codeJson.intervalSeconds) * 1000);
	}

	throw new Error("Device code expired; try again.");
}

async function runLogout() {
	await deleteConfig();
	console.log("Logged out successfully. Credentials cleared.");
	process.exit(0);
}

async function mintTunnelToken(params: { serverUrl: string; agentToken: string; workspaceId: string }) {
	const res = await fetch(new URL("/api/agent/tunnel-token", params.serverUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${params.agentToken}`,
		},
		body: JSON.stringify({ workspaceId: params.workspaceId }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`Authentication failed (${res.status}). Your saved credentials may have expired.\nPlease run: npx @opeoginni/gitterm-agent logout && npx @opeoginni/gitterm-agent login`,
			);
		}
		throw new Error(`Failed to mint tunnel token: ${res.status} ${text}`);
	}
	const json = (await res.json()) as { token: string; subdomain?: string };
	if (!json.token) throw new Error("Server did not return a token");
	return json.token;
}

async function updateWorkspacePorts(params: {
	serverUrl: string;
	agentToken: string;
	workspaceId: string;
	localPort: number;
	exposedPorts: Record<string, { port: number; description?: string }>;
}) {
	const res = await fetch(new URL("/api/agent/workspace-ports", params.serverUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${params.agentToken}`,
		},
		body: JSON.stringify({
			workspaceId: params.workspaceId,
			localPort: params.localPort,
			exposedPorts: params.exposedPorts,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`Authentication failed (${res.status}). Your saved credentials may have expired.\nPlease run: npx @opeoginni/gitterm-agent logout && npx @opeoginni/gitterm-agent login`,
			);
		}
		throw new Error(`Failed to update workspace ports: ${res.status} ${text}`);
	}
	const json = (await res.json()) as { success: boolean };
	return json;
}

function prompt(question: string): Promise<string> {
	return new Promise((resolve) => {
		process.stdout.write(question);
		process.stdin.once("data", (data) => {
			resolve(data.toString().trim());
		});
	});
}

async function runConnect(rawArgs: string[]) {
	const wsUrl = getFlag(rawArgs, "--ws-url") ?? DEFAULT_WS_URL;
	const portStr = getFlag(rawArgs, "--port");
	const targetBase = "http://localhost";

	const tokenFromFlag = getFlag(rawArgs, "--token");
	const workspaceId = getFlag(rawArgs, "--workspace-id");
	const serverUrl = getFlag(rawArgs, "--server-url") ?? DEFAULT_SERVER_URL;

	let token = tokenFromFlag;
	let primaryPort: number;
	let mainSubdomain: string;

	if (!token) {
		if (!workspaceId) throw new Error("Missing --workspace-id");
		const config = await loadConfig();
		if (!config?.agentToken) throw new Error("Not logged in. Run: npx @opeoginni/gitterm-agent login");
		const effectiveServerUrl = serverUrl;

		if (!portStr) {
			const portInput = await prompt("Enter the local port to expose (e.g. 3000): ");
			const parsedPort = Number.parseInt(portInput, 10);
			if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
				throw new Error("Invalid port number");
			}
			primaryPort = parsedPort;

			const exposedPorts: Record<string, { port: number; description?: string }> = {};

			await updateWorkspacePorts({
				serverUrl: effectiveServerUrl,
				agentToken: config.agentToken,
				workspaceId,
				localPort: primaryPort,
				exposedPorts,
			});
		} else {
			primaryPort = Number.parseInt(portStr, 10);
			if (!Number.isFinite(primaryPort) || primaryPort <= 0) throw new Error("Invalid --port");
		}

		token = await mintTunnelToken({ serverUrl: effectiveServerUrl, agentToken: config.agentToken, workspaceId });
	} else {
		if (!portStr) throw new Error("Missing --port");
		primaryPort = Number.parseInt(portStr, 10);
		if (!Number.isFinite(primaryPort) || primaryPort <= 0) throw new Error("Invalid --port");
	}

	const exposedPorts = parseExposeFlags(rawArgs);

	type PendingRequestMeta = {
		method: string;
		path: string;
		headers: Record<string, string>;
		port?: number;
	};

	const pendingRequestBodies = new Map<string, Uint8Array[]>();
	const pendingRequestMeta = new Map<string, PendingRequestMeta>();
	const activeRequests = new Map<string, AbortController>();

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
		console.log("Establishing secure tunnel for workspace...");
		ws.send(
			JSON.stringify({
				type: "auth",
				id: crypto.randomUUID(),
				token,
				port: primaryPort,
				exposedPorts,
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

		if (frame.type === "pong") return;
		if (frame.type === "open") return;
		if (frame.type === "auth") {
			mainSubdomain = frame.mainSubdomain ?? "";

			console.log("Connected! Your local workspace is now live at: \n")
			console.log(chalk.green(`https://${mainSubdomain}.gitterm.dev`), "\n")
			if (exposedPorts) {
				for (const [serviceSubdomain, port] of Object.entries(exposedPorts)) {
					console.log(chalk.green(`${serviceSubdomain}:${port} -> https://${serviceSubdomain}-${serviceSubdomain}.gitterm.dev`))
				}
			}
		};

		// Handle close frame - abort the ongoing request
		if (frame.type === "close") {
			const controller = activeRequests.get(frame.id);
			if (controller) {
				controller.abort();
				activeRequests.delete(frame.id);
			} else {
			}
			pendingRequestBodies.delete(frame.id);
			pendingRequestMeta.delete(frame.id);
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
			if (!chunks) {
				return;
			}
			if (frame.data) chunks.push(base64ToBytes(frame.data));
			if (!frame.final) return;


			// Create abort controller for this request
			const abortController = new AbortController();
			activeRequests.set(frame.id, abortController);

			const meta = pendingRequestMeta.get(frame.id);
			if (!meta) return;
			pendingRequestMeta.delete(frame.id);

			// Check if this looks like an SSE request (Accept header)
			const acceptHeader = meta.headers["accept"] || meta.headers["Accept"] || "";
			const looksLikeSSE = acceptHeader.includes("text/event-stream") || meta.path.includes("/event") || meta.path.includes("/sse");

			try {
				const reqBody = mergeBody(frame.id);

				const base = new URL(targetBase.replace(/\/$/, "") + "/");
				base.hostname = "localhost";
				base.port = String(meta.port ?? primaryPort);

				const url = new URL(meta.path.replace(/^\//, ""), base);

				const headers = new Headers(meta.headers);
				headers.delete("host");
				headers.delete("content-length");

				const upstream = await fetch(url, {
					method: meta.method,
					headers,
					body: reqBody.byteLength > 0 ? reqBody : undefined,
					redirect: "manual",
					signal: abortController.signal,
				});

				const contentType = upstream.headers.get("content-type") || "";
				const isSSE = contentType.includes("text/event-stream");

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
					activeRequests.delete(frame.id);
					ws.send(JSON.stringify({ type: "data", id: frame.id, final: true, timestamp: Date.now() } satisfies Frame));
					return;
				}

				const reader = upstream.body.getReader();
				let chunkCount = 0;
				let totalBytes = 0;
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						if (!value) continue;
						chunkCount++;
						totalBytes += value.byteLength;

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
				} finally {
					reader.releaseLock();
				}

				activeRequests.delete(frame.id);
				ws.send(JSON.stringify({ type: "data", id: frame.id, final: true, timestamp: Date.now() } satisfies Frame));
			} catch (error) {
				activeRequests.delete(frame.id);
				pendingRequestBodies.delete(frame.id);
				
				// Don't send error response if request was aborted (client disconnected)
				if (error instanceof Error && error.name === "AbortError") {
					return;
				}
				
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
		console.log("gitterm-agent closed");
	});

	ws.addEventListener("error", (event) => {
		console.error("gitterm-agent error", event);
	});

	await new Promise<void>((resolve) => {
		process.on("SIGINT", () => resolve());
		process.on("SIGTERM", () => resolve());
	});

	console.log("\nShutting down...");

	// Abort all active requests
	for (const controller of activeRequests.values()) {
		controller.abort();
	}
	activeRequests.clear();

	// Clean up pending requests
	pendingRequestBodies.clear();
	pendingRequestMeta.clear();

	try {
		ws.close();
	} catch {
		// ignore
	}

	// Give WebSocket a moment to close gracefully
	await new Promise((resolve) => setTimeout(resolve, 100));

	// Explicitly exit the process
	process.exit(0);
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0] ?? "help";

	if (command === "--help" || command === "-h") {
		console.log(usage);
		return;
	}

	if (command === "help" || hasFlag(args, "-h") || hasFlag(args, "--help")) {
		console.log(usage);
		return;
	}

	if (command === "login") {
		await runLogin(args.slice(1));
		return;
	}

	if (command === "logout") {
		await runLogout();
		return;
	}

	if (command === "connect") {
		await runConnect(args.slice(1));
		return;
	}

	console.log(usage);
	process.exitCode = 1;
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

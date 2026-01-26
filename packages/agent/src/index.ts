#!/usr/bin/env node
import { z } from "zod";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Default production URLs (hosted gitterm.dev)
const DEFAULT_WS_URL = "wss://tunnel.gitterm.dev/tunnel/connect";
const DEFAULT_SERVER_URL = "https://api.gitterm.dev";
const DEFAULT_BASE_DOMAIN = "gitterm.dev";

/**
 * Construct a workspace URL from subdomain
 */
function getWorkspaceUrl(
  subdomain: string,
  cfg?: { routingMode?: "path" | "subdomain"; baseDomain?: string; serverUrl?: string },
): string {
  const routingMode = cfg?.routingMode ?? "subdomain";
  const baseDomain = cfg?.baseDomain || DEFAULT_BASE_DOMAIN;
  const protocol = baseDomain.includes("localhost") ? "http" : "https";

  if (routingMode === "path") {
    const origin = cfg?.baseDomain
      ? `${protocol}://${baseDomain}`
      : cfg?.serverUrl || "http://localhost";
    return `${origin.replace(/\/+$/, "")}/ws/${subdomain}`;
  }

  return `${protocol}://${subdomain}.${baseDomain}`;
}

/**
 * Construct a service URL (for exposed ports)
 */
function getServiceUrl(
  mainSubdomain: string,
  serviceName: string,
  cfg?: { routingMode?: "path" | "subdomain"; baseDomain?: string; serverUrl?: string },
): string {
  const routingMode = cfg?.routingMode ?? "subdomain";
  if (routingMode === "path") {
    const baseDomain = cfg?.baseDomain || process.env.BASE_DOMAIN || DEFAULT_BASE_DOMAIN;
    const protocol = baseDomain.includes("localhost") ? "http" : "https";
    const origin = cfg?.baseDomain
      ? `${protocol}://${baseDomain}`
      : cfg?.serverUrl || "http://localhost";
    return `${origin.replace(/\/+$/, "")}/ws/${serviceName}-${mainSubdomain}`;
  }

  const baseDomain = cfg?.baseDomain || process.env.BASE_DOMAIN || DEFAULT_BASE_DOMAIN;
  const protocol = baseDomain.includes("localhost") ? "http" : "https";
  return `${protocol}://${serviceName}-${mainSubdomain}.${baseDomain}`;
}

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

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

type AgentConfig = {
  serverUrl: string;
  cliToken: string;
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
    if (!parsed.cliToken || !parsed.serverUrl) return null;
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

type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

async function loginViaDeviceCode(serverUrl: string): Promise<{ cliToken: string }> {
  const codeRes = await fetch(new URL("/api/device/code", serverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: "@opeoginni/gitterm-agent" }),
  });
  if (!codeRes.ok) throw new Error(`Failed to start device login: ${codeRes.status}`);

  const codeJson = (await codeRes.json()) as DeviceCodeResponse;

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
      return { cliToken: tokenJson.accessToken };
    }

    // 428 = authorization_pending
    if (tokenRes.status !== 428) {
      const errText = await tokenRes.text().catch(() => "");
      throw new Error(`Login failed: ${tokenRes.status} ${errText}`);
    }

    await sleep(Math.max(1, codeJson.intervalSeconds) * 1000);
  }

  throw new Error("Device code expired; try again.");
}

type LoginArgs = {
  serverUrl: string;
};

async function runLogin(args: LoginArgs) {
  console.log(`Logging in to gitterm...`);

  const { cliToken } = await loginViaDeviceCode(args.serverUrl);
  await saveConfig({ serverUrl: args.serverUrl, cliToken, createdAt: Date.now() });
  console.log("Logged in successfully!");
  process.exit(0);
}

async function runLogout() {
  await deleteConfig();
  console.log("Logged out successfully. Credentials cleared.");
  process.exit(0);
}

type AgentConnectConfig = {
  serverUrl: string;
  wsUrl: string;
  routingMode: "path" | "subdomain";
  baseDomain: string;
};

async function mintTunnelToken(params: {
  serverUrl: string;
  cliToken: string;
  workspaceId: string;
}) {
  const res = await fetch(new URL("/api/agent/tunnel-token", params.serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.cliToken}`,
    },
    body: JSON.stringify({ workspaceId: params.workspaceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      // Auto-login + retry once
      const refreshed = await loginViaDeviceCode(params.serverUrl);
      await saveConfig({
        serverUrl: params.serverUrl,
        cliToken: refreshed.cliToken,
        createdAt: Date.now(),
      });
      return await mintTunnelToken({ ...params, cliToken: refreshed.cliToken });
    }
    throw new Error(`Failed to mint tunnel token: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    token: string;
    subdomain?: string;
    connect?: AgentConnectConfig;
  };
  if (!json.token) throw new Error("Server did not return a token");
  return json;
}

async function updateWorkspacePorts(params: {
  serverUrl: string;
  cliToken: string;
  workspaceId: string;
  localPort: number;
  exposedPorts: Record<string, { port: number; description?: string }>;
}) {
  const res = await fetch(new URL("/api/agent/workspace-ports", params.serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${params.cliToken}`,
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
      // Auto-login + retry once
      const refreshed = await loginViaDeviceCode(params.serverUrl);
      await saveConfig({
        serverUrl: params.serverUrl,
        cliToken: refreshed.cliToken,
        createdAt: Date.now(),
      });
      return await updateWorkspacePorts({ ...params, cliToken: refreshed.cliToken });
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

type ConnectArgs = {
  workspaceId: string;
  port?: number;
  wsUrl?: string;
  serverUrl: string;
  token?: string;
  expose?: string[];
};

function parseExposeArgs(exposeArgs: string[] | undefined): Record<string, number> {
  const exposed: Record<string, number> = {};
  if (!exposeArgs) return exposed;

  for (const value of exposeArgs) {
    const [name, portStr] = value.split("=");
    if (!name || !portStr) throw new Error("--expose requires a value like name=3001");
    const port = Number.parseInt(portStr, 10);
    if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid port for --expose ${value}`);
    exposed[name] = port;
  }
  return exposed;
}

async function runConnect(args: ConnectArgs) {
  const targetBase = "http://localhost";

  let token = args.token;
  let primaryPort: number;
  let mainSubdomain: string = "";
  let connectCfg: AgentConnectConfig | undefined;

  if (!token) {
    if (!args.workspaceId) throw new Error("Missing --workspace-id");
    let config = await loadConfig();
    const effectiveServerUrl = args.serverUrl;

    // Auto-login if no saved credentials OR connecting to a different server
    const savedServerUrl = config?.serverUrl ? new URL(config.serverUrl).origin : null;
    const targetServerUrl = new URL(effectiveServerUrl).origin;
    const isDifferentServer = savedServerUrl && savedServerUrl !== targetServerUrl;

    if (!config?.cliToken || isDifferentServer) {
      if (isDifferentServer) {
        console.log(`Switching to ${targetServerUrl}. Starting login...`);
      } else {
        console.log("No saved credentials found. Starting login...");
      }
      const { cliToken } = await loginViaDeviceCode(effectiveServerUrl);
      config = { serverUrl: effectiveServerUrl, cliToken, createdAt: Date.now() };
      await saveConfig(config);
      console.log("Logged in successfully!\n");
    }

    if (!args.port) {
      const portInput = await prompt("Enter the local port to expose (e.g. 4096): ");
      const parsedPort = Number.parseInt(portInput, 10);
      if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
        throw new Error("Invalid port number");
      }
      primaryPort = parsedPort;

      const exposedPorts: Record<string, { port: number; description?: string }> = {};

      await updateWorkspacePorts({
        serverUrl: effectiveServerUrl,
        cliToken: config.cliToken,
        workspaceId: args.workspaceId,
        localPort: primaryPort,
        exposedPorts,
      });
    } else {
      primaryPort = args.port;
    }

    const minted = await mintTunnelToken({
      serverUrl: effectiveServerUrl,
      cliToken: config.cliToken,
      workspaceId: args.workspaceId,
    });
    token = minted.token;
    mainSubdomain = minted.subdomain ?? "";
    connectCfg = minted.connect;
  } else {
    if (!args.port) throw new Error("Missing --port");
    primaryPort = args.port;
  }

  const exposedPorts = parseExposeArgs(args.expose);

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

  const effectiveWsUrl = args.wsUrl ?? connectCfg?.wsUrl ?? DEFAULT_WS_URL;
  const ws = new WebSocket(effectiveWsUrl);

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
      ws.send(
        JSON.stringify({ type: "pong", id: frame.id, timestamp: Date.now() } satisfies Frame),
      );
      return;
    }

    if (frame.type === "pong") return;
    if (frame.type === "open") return;
    if (frame.type === "auth") {
      mainSubdomain = frame.mainSubdomain ?? mainSubdomain ?? "";

      console.log("Connected! Your workspace is now live at:\n");
      console.log(
        chalk.green(
          getWorkspaceUrl(mainSubdomain, {
            routingMode: connectCfg?.routingMode,
            baseDomain: connectCfg?.baseDomain,
            serverUrl: connectCfg?.serverUrl,
          }),
        ),
        "\n",
      );
      console.log(`Forwarding traffic to localhost:${primaryPort}`);
      if (Object.keys(exposedPorts).length > 0) {
        for (const [serviceSubdomain, port] of Object.entries(exposedPorts)) {
          console.log(
            chalk.green(
              `  ${serviceSubdomain}:${port} -> ${getServiceUrl(mainSubdomain, serviceSubdomain, {
                routingMode: connectCfg?.routingMode,
                baseDomain: connectCfg?.baseDomain,
                serverUrl: connectCfg?.serverUrl,
              })}`,
            ),
          );
        }
      }
      console.log("\nPress Ctrl+C to disconnect.\n");
    }

    // Handle close frame - abort the ongoing request
    if (frame.type === "close") {
      const controller = activeRequests.get(frame.id);
      if (controller) {
        controller.abort();
        activeRequests.delete(frame.id);
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

      try {
        const reqBody = mergeBody(frame.id);

        const base = new URL(targetBase.replace(/\/$/, "") + "/");
        base.hostname = "localhost";
        base.port = String(meta.port ?? primaryPort);

        const url = new URL(meta.path.replace(/^\//, ""), base);

        const headers = new Headers(meta.headers);
        // Remove hop-by-hop headers that shouldn't be forwarded
        // Node's undici fetch rejects these headers
        headers.delete("host");
        headers.delete("content-length");
        headers.delete("connection");
        headers.delete("keep-alive");
        headers.delete("proxy-authenticate");
        headers.delete("proxy-authorization");
        headers.delete("te");
        headers.delete("trailers");
        headers.delete("transfer-encoding");
        headers.delete("upgrade");

        const upstream = await fetch(url, {
          method: meta.method,
          headers,
          body: reqBody.byteLength > 0 ? (reqBody as unknown as BodyInit) : undefined,
          redirect: "manual",
          signal: abortController.signal,
        });

        ws.send(
          JSON.stringify({
            type: "response",
            id: frame.id,
            statusCode: upstream.status,
            headers: headersToRecord(upstream.headers),
            timestamp: Date.now(),
          } satisfies Frame),
        );

        if (!upstream.body) {
          activeRequests.delete(frame.id);
          ws.send(
            JSON.stringify({
              type: "data",
              id: frame.id,
              final: true,
              timestamp: Date.now(),
            } satisfies Frame),
          );
          return;
        }

        const reader = upstream.body.getReader();
        try {
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
        } finally {
          reader.releaseLock();
        }

        activeRequests.delete(frame.id);
        ws.send(
          JSON.stringify({
            type: "data",
            id: frame.id,
            final: true,
            timestamp: Date.now(),
          } satisfies Frame),
        );
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
            data: bytesToBase64(
              new TextEncoder().encode(JSON.stringify({ error: "upstream_error" })),
            ),
            final: true,
            timestamp: Date.now(),
          } satisfies Frame),
        );
      }
    }
  });

  ws.addEventListener("close", () => {
    console.log("Disconnected from tunnel.");
    process.exit(0);
  });

  ws.addEventListener("error", (event) => {
    console.error("Connection error:", event);
  });

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });

  console.log("\nDisconnecting...");

  // Abort all active requests
  for (const controller of Array.from(activeRequests.values())) {
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

  process.exit(0);
}

// CLI setup with yargs
yargs(hideBin(process.argv))
  .scriptName("gitterm-agent")
  .usage("$0 <command> [options]")
  .command(
    "login",
    "Sign in via device-code flow",
    (yargs) => {
      return yargs.option("server-url", {
        alias: "s",
        type: "string",
        description: "Server base URL",
        default: DEFAULT_SERVER_URL,
      });
    },
    async (argv) => {
      try {
        await runLogin({ serverUrl: argv.serverUrl });
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .command(
    "logout",
    "Clear saved credentials",
    () => {},
    async () => {
      try {
        await runLogout();
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .command(
    "connect",
    "Connect a local port to your workspace",
    (yargs) => {
      return yargs
        .option("workspace-id", {
          alias: "w",
          type: "string",
          description: "Workspace ID",
          demandOption: true,
        })
        .option("port", {
          alias: "p",
          type: "number",
          description: "Local port to expose",
        })
        .option("ws-url", {
          type: "string",
          description: "Tunnel-proxy WebSocket URL",
        })
        .option("server-url", {
          alias: "s",
          type: "string",
          description: "Server base URL",
          default: DEFAULT_SERVER_URL,
        })
        .option("token", {
          alias: "t",
          type: "string",
          description: "Tunnel JWT (overrides saved login)",
        })
        .option("expose", {
          alias: "e",
          type: "array",
          string: true,
          description: "Expose additional service port (name=port)",
        });
    },
    async (argv) => {
      try {
        await runConnect({
          workspaceId: argv.workspaceId,
          port: argv.port,
          wsUrl: argv.wsUrl,
          serverUrl: argv.serverUrl,
          token: argv.token,
          expose: argv.expose,
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .alias("help", "h")
  .version(false)
  .strict()
  .parse();

import { createHmac } from "node:crypto";
import {
  SandboxProviderError,
  type SandboxCommandResult,
  type SandboxPreviewAccess,
} from "./types";

/**
 * For container providers without a command API (Railway, AWS ECS), a stock Node image
 * runs this server as its start command. It is not a coding agent: it runs `sh -c`,
 * writes files, reads files, and forwards preview requests to a local port, only for
 * requests carrying the `x-gitterm-token` header.
 *
 * Previews: these providers give a sandbox one public endpoint, so a request with
 * `x-gitterm-port: N` is proxied to 127.0.0.1:N. Without the token it is rejected, which
 * makes previews private. The token is an HMAC of the provider credential and the
 * sandbox name, so it is never stored: whoever holds the provider credential can derive it.
 */
export const EXEC_SERVER_SOURCE = String.raw`
const http = require("http"), cp = require("child_process"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const token = Buffer.from(process.env.GITTERM_EXEC_TOKEN || "");
delete process.env.GITTERM_EXEC_TOKEN;
delete process.env.GITTERM_EXEC_SERVER;
const MAX = 32 * 1024 * 1024;
const authorized = (req) => {
  const given = Buffer.from(String(req.headers["x-gitterm-token"] || ""));
  return token.length > 0 && given.length === token.length && crypto.timingSafeEqual(given, token);
};
const body = (req) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > MAX) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://sandbox");
  if (url.pathname === "/healthz" && !req.headers["x-gitterm-port"]) return res.end("ok");
  if (!authorized(req)) return res.writeHead(401).end();
  const port = Number(req.headers["x-gitterm-port"]);
  if (port) {
    const headers = { ...req.headers };
    delete headers["x-gitterm-token"]; delete headers["x-gitterm-port"];
    const upstream = http.request({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (reply) => {
      res.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    return req.pipe(upstream);
  }
  try {
    if (url.pathname === "/run" && req.method === "POST") {
      const input = JSON.parse((await body(req)).toString());
      const child = cp.spawn("sh", ["-c", input.command], {
        cwd: input.cwd || process.env.HOME || "/",
        env: { ...process.env, ...(input.env || {}) },
      });
      const out = [], err = []; let kept = 0;
      const keep = (into) => (chunk) => { if (kept < 16 * 1024 * 1024) { into.push(chunk); kept += chunk.length; } };
      child.stdout.on("data", keep(out)); child.stderr.on("data", keep(err));
      const timer = setTimeout(() => child.kill("SIGKILL"), input.timeoutMs || 60000);
      child.on("error", () => {});
      child.on("close", (code) => {
        clearTimeout(timer);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ exitCode: code === null ? 137 : code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
      });
      return;
    }
    const file = url.searchParams.get("path");
    if (url.pathname === "/file" && file && path.isAbsolute(file)) {
      if (req.method === "PUT") {
        const data = await body(req);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
        return res.end("ok");
      }
      if (req.method === "GET") return res.end(fs.readFileSync(file));
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(error && error.code === "ENOENT" ? 404 : 500).end();
  }
});
server.on("upgrade", (req, socket) => socket.destroy());
server.listen(Number(process.env.PORT || 8080), "::");
`;

export const EXEC_SERVER_PORT = 8080;
/** Shell start command for a stock Node image; the server source travels in an env var. */
export const EXEC_SERVER_START_COMMAND = `sh -c 'node -e "$GITTERM_EXEC_SERVER"'`;

export function execServerToken(credential: string, sandboxName: string): string {
  return createHmac("sha256", credential).update(`gitterm-exec:${sandboxName}`).digest("hex");
}

/** `routing` headers reach the sandbox through a shared load balancer (AWS). */
export function createExecServerClient(
  baseUrl: string,
  token: string,
  provider: string,
  routing: Record<string, string> = {},
) {
  const base = baseUrl.replace(/\/$/, "");
  const request = async (path: string, init: RequestInit & { timeoutMs?: number }) => {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...init.headers, ...routing, "x-gitterm-token": token },
        redirect: "error",
        signal: AbortSignal.timeout(init.timeoutMs ?? 120_000),
      });
    } catch {
      throw new SandboxProviderError(
        "provider",
        `Could not reach the ${provider} sandbox command server.`,
      );
    }
    if (response.status === 401)
      throw new SandboxProviderError(
        "auth",
        `The ${provider} sandbox rejected the derived access token.`,
      );
    if (response.status === 404)
      throw new SandboxProviderError("not_found", "File or endpoint not found in the sandbox.");
    if (!response.ok)
      throw new SandboxProviderError(
        "provider",
        `The ${provider} sandbox command server failed (${response.status}).`,
      );
    return response;
  };
  return {
    async ready(): Promise<boolean> {
      return fetch(`${base}/healthz`, { headers: routing, signal: AbortSignal.timeout(5_000) })
        .then((response) => response.ok)
        .catch(() => false);
    },
    async run(
      command: string,
      options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
    ): Promise<SandboxCommandResult> {
      const timeoutMs = options.timeoutMs ?? 60_000;
      const response = await request("/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command, cwd: options.cwd, env: options.env, timeoutMs }),
        timeoutMs: timeoutMs + 15_000,
      });
      return (await response.json()) as SandboxCommandResult;
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      await request(`/file?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        body: data as BodyInit,
      });
    },
    async readFile(path: string): Promise<Uint8Array> {
      return new Uint8Array(
        await (
          await request(`/file?path=${encodeURIComponent(path)}`, { method: "GET" })
        ).arrayBuffer(),
      );
    },
    preview(port: number): SandboxPreviewAccess {
      return {
        url: `${base}/`,
        headers: { ...routing, "x-gitterm-token": token, "x-gitterm-port": String(port) },
      };
    },
  };
}

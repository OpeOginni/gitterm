#!/usr/bin/env bun
/**
 * Mock workspace upstreams: what a proxied workspace looks like from Caddy's side.
 * One process listens on many ports so each port stands in for a separate workspace host.
 *
 *   bun benchmarks/platform/upstream.ts --count 50 --tls-count 50
 *
 * Routes (all ports):
 *   GET  /ping              2-byte body, the per-request overhead probe
 *   GET  /bytes/<n>         n bytes of body
 *   POST /upload            reads the body, answers {"bytes": n}
 *   GET  /headers           echoes the request headers as JSON (what did Caddy forward?)
 *   GET  /sse?n=&gap=&size= n events `gap` ms apart, each carrying its send time
 *   GET  /status/<code>     answers with that status and a JSON body
 *   GET  /ws                WebSocket echo
 *   GET  /__stats           connections accepted and requests served, per port
 *   POST /__reset           zero the counters
 *
 * It also answers the OpenCode 2 routes the run watcher reads (see `opencode()`), for a
 * session built with POST /__opencode?session=<id>&turns=&assistant=&bytes=.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PORTS, STATE_DIR } from "./lib/config";

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const count = arg("count", 1);
const tlsCount = arg("tls-count", 0);

type Counter = { connections: number; requests: number };
const counters = new Map<number, Counter>();
/**
 * `listenPort|clientAddress:clientPort` pairs already counted. Bun exposes no accept hook;
 * a keep-alive connection keeps its client port, so a new pair is a new TCP connection.
 */
const clients = new Set<string>();

const CHUNK = new Uint8Array(64 * 1024).fill(97);

function bytesBody(total: number): ReadableStream<Uint8Array> | Uint8Array {
  if (total <= CHUNK.length) return CHUNK.subarray(0, total);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      const size = Math.min(CHUNK.length, total - sent);
      controller.enqueue(CHUNK.subarray(0, size));
      sent += size;
      if (sent >= total) controller.close();
    },
  });
}

function sse(n: number, gapMs: number, size: number): Response {
  const padding = "x".repeat(Math.max(0, size));
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let sent = 0;
      const send = () => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ i: sent, t: Date.now(), p: padding })}\n\n`),
        );
        sent += 1;
        if (sent >= n) {
          clearInterval(timer);
          controller.close();
        }
      };
      send();
      if (n > 1) timer = setInterval(send, gapMs);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

/** Message pages of each mock OpenCode session, serialized once. */
const sessions = new Map<string, { messages: unknown[]; pages: Map<string, string> }>();

/** `turns` prompts, each answered by `assistant` messages that carry one tool call with `bytes` of output. */
function buildSession(id: string, turns: number, assistant: number, bytes: number) {
  const messages: unknown[] = [];
  const output = "x".repeat(bytes);
  let created = 1_788_510_000_000;
  let lastUser = "";
  for (let turn = 0; turn < turns; turn += 1) {
    lastUser = `msg_${id}_${turn}_user`;
    messages.push({
      type: "user",
      id: lastUser,
      time: { created: (created += 1000) },
      text: `Prompt ${turn}: ${"please look into this ".repeat(8)}`,
    });
    for (let n = 0; n < assistant; n += 1) {
      const last = n === assistant - 1;
      messages.push({
        type: "assistant",
        id: `msg_${id}_${turn}_${n}`,
        time: { created: (created += 1000), streamed: created + 200, completed: created + 900 },
        finish: last ? "stop" : "tool-calls",
        agent: "build",
        model: { id: "bench-model", providerID: "bench" },
        content: last
          ? [{ type: "text", text: `Done with step ${turn}. ${"Summary sentence. ".repeat(20)}` }]
          : [
              { type: "reasoning", text: "Thinking about the next step. ".repeat(10) },
              {
                type: "tool",
                id: `call_${turn}_${n}`,
                name: "read",
                state: {
                  status: "completed",
                  input: { path: `src/file-${n}.ts` },
                  content: [{ type: "text", text: output }],
                  metadata: { exit: 0 },
                },
                time: { created, ran: created + 100, completed: created + 800 },
              },
            ],
      });
    }
  }
  sessions.set(id, { messages, pages: new Map() });
  return { messages: messages.length, lastUserMessageId: lastUser };
}

/** The subset of the OpenCode 2 HTTP API that `runtime.snapshot()` calls. */
function opencode(url: URL): Response | null {
  const path = url.pathname;
  if (path === "/api/session/active") return Response.json({ data: {} });
  const match = path.match(/^\/api\/session\/([^/]+)(?:\/(message|permission|form))?$/);
  if (!match) return null;
  const session = sessions.get(match[1]!);
  if (!session) return Response.json({ _tag: "NotFound" }, { status: 404 });
  if (!match[2]) return Response.json({ data: { id: match[1], title: "Bench session" } });
  if (match[2] !== "message") return Response.json({ data: [] });
  // A cursor carries its direction, as the real server rejects `order` next to `cursor`.
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const [direction = url.searchParams.get("order") ?? "asc", start = "0"] = (
    url.searchParams.get("cursor") ?? ""
  )
    .split(":")
    .filter(Boolean);
  const offset = Number(start);
  const key = `${direction}:${offset}:${limit}`;
  let page = session.pages.get(key);
  if (!page) {
    const ordered = direction === "desc" ? session.messages.toReversed() : session.messages;
    const next = offset + limit < ordered.length ? `${direction}:${offset + limit}` : null;
    page = JSON.stringify({ data: ordered.slice(offset, offset + limit), cursor: { next } });
    session.pages.set(key, page);
  }
  return new Response(page, { headers: { "content-type": "application/json" } });
}

function listen(port: number, tls?: { key: string; cert: string }) {
  const counter: Counter = { connections: 0, requests: 0 };
  counters.set(port, counter);
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    tls: tls ? { key: Bun.file(tls.key), cert: Bun.file(tls.cert) } : undefined,
    async fetch(request, server) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/__stats") {
        return Response.json(Object.fromEntries(counters));
      }
      if (path === "/__reset") {
        for (const value of counters.values()) {
          value.connections = 0;
          value.requests = 0;
        }
        // Forget seen clients too: otherwise a new connection that reuses an old client
        // port is not counted. Connections kept alive across the reset count once more,
        // so callers reset, send a little traffic, then read /__stats twice.
        clients.clear();
        return new Response("ok");
      }

      if (path === "/__opencode") {
        const param = (name: string, fallback: number) =>
          Number(url.searchParams.get(name) ?? fallback);
        return Response.json(
          buildSession(
            url.searchParams.get("session") ?? "ses_bench",
            param("turns", 1),
            param("assistant", 8),
            param("bytes", 4096),
          ),
        );
      }

      counter.requests += 1;
      const address = server.requestIP(request);
      const client = address ? `${port}|${address.address}:${address.port}` : "";
      if (client && !clients.has(client)) {
        clients.add(client);
        counter.connections += 1;
      }

      if (path.startsWith("/api/")) {
        const response = opencode(url);
        if (response) return response;
      }
      if (path === "/ping") return new Response("ok");
      if (path.startsWith("/bytes/")) {
        const total = Number(path.slice(7));
        return new Response(bytesBody(total), {
          headers: { "content-type": "application/octet-stream", "content-length": String(total) },
        });
      }
      if (path === "/upload") {
        let total = 0;
        if (request.body) for await (const chunk of request.body) total += chunk.byteLength;
        return Response.json({ bytes: total });
      }
      if (path === "/headers") return Response.json(Object.fromEntries(request.headers));
      if (path === "/sse") {
        return sse(
          Number(url.searchParams.get("n") ?? 10),
          Number(url.searchParams.get("gap") ?? 100),
          Number(url.searchParams.get("size") ?? 0),
        );
      }
      if (path.startsWith("/status/")) {
        const status = Number(path.slice(8));
        return Response.json({ error: "upstream_error", status }, { status });
      }
      if (path === "/ws") {
        return server.upgrade(request)
          ? undefined
          : new Response("upgrade failed", { status: 400 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      message(ws, message) {
        ws.send(message);
      },
    },
  });
}

for (let index = 0; index < count; index += 1) listen(PORTS.upstream + index);

if (tlsCount > 0) {
  mkdirSync(STATE_DIR, { recursive: true });
  const key = join(STATE_DIR, "upstream.key");
  const cert = join(STATE_DIR, "upstream.crt");
  if (!existsSync(key) || !existsSync(cert)) {
    const made = Bun.spawnSync([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ]);
    if (made.exitCode !== 0) throw new Error(`openssl failed: ${made.stderr.toString()}`);
  }
  for (let index = 0; index < tlsCount; index += 1)
    listen(PORTS.upstreamTls + index, { key, cert });
}

console.log(
  `upstreams ready: ${count} http from :${PORTS.upstream}, ${tlsCount} tls from :${PORTS.upstreamTls}`,
);

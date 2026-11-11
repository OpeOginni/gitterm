#!/usr/bin/env bun
/**
 * End to end through Caddy: client -> Caddy -> forward_auth (API) -> mock workspace.
 * Every section runs the same traffic straight at the mock workspace first, so the
 * difference is what the proxy path adds.
 *
 *   bun benchmarks/platform/bench-proxy.ts [--only overhead,download,upload,reuse,sse,ws,idle]
 *                                          [--duration 5] [--concurrency 1,16,64] [--cooldown 0]
 *                                          [--name proxy]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CADDY_URL, PORTS, STATE_DIR, loadState, saveResult, workspaceHost } from "./lib/config";
import { load, row, summarize, type LoadResult } from "./lib/load";
import { resetUpstreamStats, totals, upstreamStats } from "./lib/probes";

const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1]!;
};
const only = flag("only", "overhead,download,upload,reuse,sse,ws,idle").split(",");
const durationMs = Number(flag("duration", "5")) * 1000;
const levels = flag("concurrency", "1,16,64").split(",").map(Number);
/** Seconds to rest between overhead runs, so closed sockets leave TIME_WAIT (see README). */
const cooldownMs = Number(flag("cooldown", "0")) * 1000;
const state = loadState();
const results: Record<string, unknown> = {};

const direct = (path: string, port: number = PORTS.upstream) => `http://127.0.0.1:${port}${path}`;
const directTls = (path: string) => `https://127.0.0.1:${PORTS.upstreamTls}${path}`;
const pick = (list: string[], index: number, spread = list.length) =>
  list[index % Math.min(spread, list.length)]!;
const viaProxy = (path: string, host: string, session = false) => ({
  url: `${CADDY_URL}${path}`,
  headers: { Host: host, ...(session ? { Cookie: state.cookie } : {}) },
});
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// The mock upstream uses a self-signed certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function overhead() {
  console.log("\n== overhead: GET /ping (2-byte body)");
  const cases: Array<{
    name: string;
    request: (i: number) => { url: string; headers?: Record<string, string> };
  }> = [
    { name: "direct to workspace", request: () => ({ url: direct("/ping") }) },
    {
      name: "proxy, server-only (no session)",
      request: (i) => viaProxy("/ping", workspaceHost(pick(state.subdomains.serverOnly, i, 1))),
    },
    {
      name: "proxy, public port",
      request: (i) =>
        viaProxy("/ping", workspaceHost(pick(state.subdomains.publicPort, i, 1), 3000)),
    },
    {
      name: "proxy, private (session)",
      request: (i) => viaProxy("/ping", workspaceHost(pick(state.subdomains.private, i, 1)), true),
    },
    { name: "direct to TLS workspace", request: () => ({ url: directTls("/ping") }) },
    {
      name: "proxy, private TLS upstream",
      request: (i) =>
        viaProxy("/ping", workspaceHost(pick(state.subdomains.privateTls, i, 1)), true),
    },
  ];
  const out: Record<string, LoadResult[]> = {};
  for (const item of cases) {
    out[item.name] = [];
    for (const concurrency of levels) {
      await Bun.sleep(cooldownMs);
      const result = await load({ request: item.request, concurrency, durationMs, warmupMs: 500 });
      out[item.name]!.push(result);
      console.log(row(`  ${item.name}`, result));
    }
  }
  results.overhead = out;
}

async function download() {
  console.log("\n== download: GET /bytes/<n>, MB/s of response body");
  const host = workspaceHost(state.subdomains.serverOnly[0]!);
  const out: unknown[] = [];
  for (const size of [1_024, 65_536, 1_048_576, 16_777_216, 134_217_728]) {
    for (const concurrency of size >= 16_777_216 ? [1, 4] : [1, 16]) {
      const path = `/bytes/${size}`;
      const a = await load({ request: () => ({ url: direct(path) }), concurrency, durationMs });
      const b = await load({ request: () => viaProxy(path, host), concurrency, durationMs });
      const line = {
        size,
        concurrency,
        directMBps: mb(a.bytesPerSecond),
        proxyMBps: mb(b.bytesPerSecond),
        directP50: a.latencyMs.p50,
        proxyP50: b.latencyMs.p50,
        proxyErrors: b.errors,
      };
      out.push(line);
      console.log(
        `  ${String(size).padStart(10)} B  c=${concurrency}  direct ${String(line.directMBps).padStart(8)} MB/s p50 ${a.latencyMs.p50.toFixed(2).padStart(8)} ms   proxy ${String(line.proxyMBps).padStart(8)} MB/s p50 ${b.latencyMs.p50.toFixed(2).padStart(8)} ms${b.errors ? `  errors ${JSON.stringify(b.statuses)}` : ""}`,
      );
    }
  }
  results.download = out;
}

async function upload() {
  console.log("\n== upload: POST /upload, MB/s of request body");
  const host = workspaceHost(state.subdomains.serverOnly[0]!);
  const out: unknown[] = [];
  for (const size of [1_024, 1_048_576, 16_777_216, 134_217_728]) {
    const body = new Uint8Array(size).fill(98);
    const concurrency = size >= 16_777_216 ? 1 : 8;
    const post = { method: "POST", body, headers: { "content-type": "application/octet-stream" } };
    const a = await load({
      request: () => ({ url: direct("/upload"), ...post }),
      concurrency,
      durationMs,
    });
    const b = await load({
      request: () => {
        const spec = viaProxy("/upload", host);
        return { ...spec, ...post, headers: { ...spec.headers, ...post.headers } };
      },
      concurrency,
      durationMs,
    });
    const line = {
      size,
      concurrency,
      // Only uploads that were accepted count.
      directMBps: mb(((a.requests - a.errors) * size) / (durationMs / 1000)),
      proxyMBps: mb(((b.requests - b.errors) * size) / (durationMs / 1000)),
      directP50: a.latencyMs.p50,
      proxyP50: b.latencyMs.p50,
      proxyErrors: b.errors,
      proxyStatuses: b.statuses,
    };
    out.push(line);
    console.log(
      `  ${String(size).padStart(10)} B  c=${concurrency}  direct ${String(line.directMBps).padStart(8)} MB/s p50 ${a.latencyMs.p50.toFixed(2).padStart(8)} ms   proxy ${String(line.proxyMBps).padStart(8)} MB/s p50 ${b.latencyMs.p50.toFixed(2).padStart(8)} ms${b.errors ? `  errors ${JSON.stringify(b.statuses)}` : ""}`,
    );
  }
  results.upload = out;
}

/** How many new upstream connections Caddy opens when traffic is spread over many workspaces. */
async function reuse() {
  console.log("\n== upstream connection reuse: requests spread over N workspaces (c=16)");
  const out: unknown[] = [];
  for (const [label, list] of [
    ["http", state.subdomains.serverOnly],
    ["tls", state.subdomains.privateTls],
  ] as const) {
    for (const spread of [1, 8, 16, 50]) {
      if (spread > (label === "tls" ? state.tlsUpstreams : state.upstreams)) continue;
      const request = (i: number) =>
        viaProxy("/ping", workspaceHost(pick(list, i, spread)), label === "tls");
      await load({ request, concurrency: 16, durationMs: 500 });
      await resetUpstreamStats();
      // Pooled connections count once after a reset; let them, then measure the delta.
      await load({ request, concurrency: 16, durationMs: 300 });
      const start = totals(await upstreamStats());
      const result = await load({
        request,
        concurrency: 16,
        durationMs: Math.min(durationMs, 3000),
      });
      const end = totals(await upstreamStats());
      const stats = {
        connections: end.connections - start.connections,
        requests: end.requests - start.requests,
      };
      const line = {
        upstream: label,
        workspaces: spread,
        rps: result.rps,
        p50: result.latencyMs.p50,
        p99: result.latencyMs.p99,
        requests: stats.requests,
        newConnections: stats.connections,
        newConnectionsPer1000: Math.round((stats.connections / Math.max(1, stats.requests)) * 1000),
        errors: result.errors,
      };
      out.push(line);
      console.log(
        `  ${label.padEnd(4)} ${String(spread).padStart(3)} workspaces  ${String(result.rps).padStart(6)} rps  p50 ${result.latencyMs.p50.toFixed(2).padStart(6)}  p99 ${result.latencyMs.p99.toFixed(2).padStart(7)} ms  new upstream connections per 1000 requests: ${line.newConnectionsPer1000}${result.errors ? `  errors ${JSON.stringify(result.statuses)}` : ""}`,
      );
    }
  }
  results.reuse = out;
}

async function sseDelays(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const delays: number[] = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const now = Date.now();
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const sent = JSON.parse(event.slice(6)) as { t: number };
      delays.push(now - sent.t);
    }
  }
  return delays;
}

async function sse() {
  console.log("\n== SSE: delay between an event being written upstream and read by the client");
  const out: unknown[] = [];
  const host = workspaceHost(state.subdomains.serverOnly[0]!);
  for (const [n, gap, size, streams] of [
    [100, 20, 200, 1],
    [100, 20, 200, 50],
    [50, 20, 16_384, 20],
  ] as const) {
    const path = `/sse?n=${n}&gap=${gap}&size=${size}`;
    for (const [label, url, headers] of [
      ["direct", direct(path), {}],
      ["proxy", `${CADDY_URL}${path}`, { Host: host }],
    ] as const) {
      const all = (
        await Promise.all(Array.from({ length: streams }, () => sseDelays(url, headers)))
      ).flat();
      const stats = summarize(all);
      out.push({
        events: n,
        gapMs: gap,
        eventBytes: size,
        streams,
        path: label,
        received: all.length,
        delayMs: stats,
      });
      console.log(
        `  ${String(streams).padStart(3)} streams x ${n} events of ${String(size).padStart(5)} B  ${label.padEnd(10)}  received ${all.length}  delay p50 ${stats.p50} p99 ${stats.p99} max ${stats.max} ms`,
      );
    }
  }
  results.sse = out;
}

function openSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Bun accepts request headers on the WebSocket constructor.
    const socket = new WebSocket(url, { headers } as unknown as string[]);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error(`websocket failed: ${url}`));
  });
}

async function echo(socket: WebSocket, payload: string | Uint8Array, count: number) {
  const samples: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await new Promise<void>((resolve) => {
      socket.onmessage = () => resolve();
      socket.send(payload);
    });
    samples.push(performance.now() - started);
  }
  return samples;
}

async function ws() {
  console.log("\n== WebSocket echo: round trip per message");
  const out: unknown[] = [];
  const host = workspaceHost(state.subdomains.private[0]!);
  const targets = [
    ["direct", `ws://127.0.0.1:${PORTS.upstream}/ws`, {}],
    ["proxy", `ws://127.0.0.1:${PORTS.caddy}/ws`, { Host: host, Cookie: state.cookie }],
  ] as const;
  for (const [size, count] of [
    [32, 2000],
    [65_536, 500],
    [1_048_576, 100],
  ] as const) {
    const payload = new Uint8Array(size).fill(99);
    for (const [label, url, headers] of targets) {
      const opened = performance.now();
      const socket = await openSocket(url, headers);
      const connectMs = Math.round((performance.now() - opened) * 100) / 100;
      const samples = await echo(socket, payload, count);
      socket.close();
      const stats = summarize(samples);
      const seconds = samples.reduce((a, b) => a + b, 0) / 1000;
      const line = {
        path: label,
        messageBytes: size,
        connectMs,
        roundTripMs: stats,
        MBps: mb((size * count * 2) / seconds),
      };
      out.push(line);
      console.log(
        `  ${String(size).padStart(8)} B  ${label.padEnd(6)}  connect ${String(connectMs).padStart(6)} ms  rt p50 ${stats.p50.toFixed(3)} p99 ${stats.p99.toFixed(3)} ms  ${line.MBps} MB/s both ways`,
      );
    }
  }
  results.ws = out;
}

/** Resident memory of a process the rig started, by its pid file. */
function rssMb(name: string): number {
  let pid = "";
  try {
    pid = readFileSync(join(STATE_DIR, `${name}.pid`), "utf8").trim();
  } catch {
    return 0;
  }
  const kb = Number(Bun.spawnSync(["ps", "-o", "rss=", "-p", pid]).stdout.toString().trim());
  return Math.round(kb / 1024);
}

/** Memory held per idle proxied connection, and how fast a burst of them can be opened. */
async function idle() {
  console.log("\n== idle connections: WebSockets held open through the proxy");
  const out: unknown[] = [];
  const sockets: WebSocket[] = [];
  const before = { caddy: rssMb("caddy"), server: rssMb("server-0") };
  console.log(`  baseline rss  caddy ${before.caddy} MB  server ${before.server} MB`);
  for (const target of [500, 2000, 4000]) {
    const started = performance.now();
    let failed = 0;
    while (sockets.length < target) {
      const batch = Array.from({ length: Math.min(100, target - sockets.length) }, (_, index) =>
        openSocket(`ws://127.0.0.1:${PORTS.caddy}/ws`, {
          Host: workspaceHost(pick(state.subdomains.private, sockets.length + index)),
          Cookie: state.cookie,
        }).catch(() => null),
      );
      for (const socket of await Promise.all(batch)) {
        if (socket) sockets.push(socket);
        else failed += 1;
      }
      if (failed > 200) break;
    }
    const seconds = (performance.now() - started) / 1000;
    await Bun.sleep(1000);
    const line = {
      open: sockets.length,
      failed,
      opensPerSecond: Math.round(
        (sockets.length - (out.length ? (out[out.length - 1] as { open: number }).open : 0)) /
          seconds,
      ),
      caddyRssMb: rssMb("caddy"),
      serverRssMb: rssMb("server-0"),
    };
    out.push(line);
    console.log(
      `  ${String(line.open).padStart(5)} open (${failed} failed)  ${line.opensPerSecond} opens/s  caddy ${line.caddyRssMb} MB  server ${line.serverRssMb} MB`,
    );
    if (failed > 200) break;
  }
  for (const socket of sockets) socket.close();
  results.idle = out;
}

const sections: Record<string, () => Promise<void>> = {
  overhead,
  download,
  upload,
  reuse,
  sse,
  ws,
  idle,
};
for (const name of only) await sections[name]?.();
console.log(`\nsaved ${saveResult(flag("name", "proxy"), results)}`);
process.exit(0);

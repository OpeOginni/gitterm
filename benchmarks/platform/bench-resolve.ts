#!/usr/bin/env bun
/**
 * Load on GET /api/internal/proxy-resolve, the call Caddy's forward_auth makes for
 * every workspace request. Sent straight to the API server with the headers Caddy sends.
 *
 *   bun benchmarks/platform/bench-resolve.ts [--duration 5] [--concurrency 1,16,64,256] [--only private]
 *
 * For each scenario it prints the Redis commands and Postgres statements one request
 * costs, then throughput and latency at each concurrency.
 */
import { INTERNAL_API_KEY, SERVER_URL, loadState, saveResult, workspaceHost } from "./lib/config";
import { load, row, type LoadResult } from "./lib/load";
import { closeProbes, diff, redisCommands, resetStatements, statements } from "./lib/probes";

const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1]!;
};
const durationMs = Number(flag("duration", "5")) * 1000;
const levels = flag("concurrency", "1,16,64,256").split(",").map(Number);
const only = flag("only", "");

const state = loadState();
const url = `${SERVER_URL}/api/internal/proxy-resolve`;
const base = (host: string, extra: Record<string, string> = {}) => ({
  url,
  headers: {
    Host: host,
    "X-Internal-Key": INTERNAL_API_KEY,
    "X-Original-URI": "/ping",
    "X-Original-Method": "GET",
    "X-Forwarded-For": "203.0.113.7",
    "X-Routing-Mode": "subdomain",
    ...extra,
  },
});
const pick = (list: string[], index: number) => list[index % list.length]!;
const randomSubdomain = () => crypto.randomUUID().slice(0, 8);

type Scenario = {
  name: string;
  expect: number;
  request: (index: number) => { url: string; headers: Record<string, string> };
};

const scenarios: Scenario[] = [
  {
    name: "private (owner session)",
    expect: 200,
    request: (i) =>
      base(workspaceHost(pick(state.subdomains.private, i)), { Cookie: state.cookie }),
  },
  {
    name: "private, one workspace",
    expect: 200,
    request: () => base(workspaceHost(state.subdomains.private[0]!), { Cookie: state.cookie }),
  },
  {
    name: "private, no session",
    expect: 403,
    request: (i) => base(workspaceHost(pick(state.subdomains.private, i))),
  },
  {
    name: "server-only (no session check)",
    expect: 200,
    request: (i) => base(workspaceHost(pick(state.subdomains.serverOnly, i))),
  },
  {
    name: "public port",
    expect: 200,
    request: (i) => base(workspaceHost(pick(state.subdomains.publicPort, i), 3000)),
  },
  {
    name: "unknown subdomain, repeated",
    expect: 404,
    request: () => base(workspaceHost("zzzzzzzz")),
  },
  {
    name: "unknown subdomain, random",
    expect: 404,
    request: () => base(workspaceHost(randomSubdomain())),
  },
];

const results: Record<string, { perRequest: unknown; runs: LoadResult[] }> = {};

for (const scenario of scenarios) {
  if (only && !scenario.name.startsWith(only)) continue;
  console.log(`\n== ${scenario.name}`);

  // Warm caches, then count what a steady-state request costs.
  await load({
    request: scenario.request,
    concurrency: 4,
    durationMs: 1000,
    expectStatus: scenario.expect,
  });
  await resetStatements();
  const before = await redisCommands();
  const probe = await load({
    request: scenario.request,
    concurrency: 1,
    durationMs: 3000,
    expectStatus: scenario.expect,
  });
  const redis = diff(before, await redisCommands());
  delete redis.info;
  const perRequest = (count: number) => Math.round((count / probe.requests) * 100) / 100;
  const redisPerRequest = Object.fromEntries(
    Object.entries(redis).map(([command, count]) => [command, perRequest(count)]),
  );
  const sql = (await statements(6)).map((statement) => ({
    perRequest: perRequest(statement.calls),
    meanMs: statement.meanMs,
    query: statement.query.slice(0, 140),
  }));
  console.log("  redis commands per request (caches warm):", JSON.stringify(redisPerRequest));
  for (const statement of sql) {
    if (statement.perRequest < 0.01) continue;
    console.log(`  sql ${statement.perRequest}/req  ${statement.meanMs} ms  ${statement.query}`);
  }

  const runs: LoadResult[] = [];
  for (const concurrency of levels) {
    const result = await load({
      request: scenario.request,
      concurrency,
      durationMs,
      warmupMs: 500,
      expectStatus: scenario.expect,
    });
    runs.push(result);
    console.log(row("  ", result));
  }
  results[scenario.name] = { perRequest: { redis: redisPerRequest, sql }, runs };
}

console.log(`\nsaved ${saveResult(flag("name", "resolve"), results)}`);
await closeProbes();

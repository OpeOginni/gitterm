#!/usr/bin/env bun
/**
 * What one run-watcher snapshot costs as an OpenCode session, and the run in it, grow.
 *
 * The watcher (packages/api/src/service/agent-run/watcher.ts) calls `runtime.snapshot()`
 * at most once a second per active run. This calls the real runtime client against a mock
 * OpenCode session, directly and through Caddy (the API reaches workspaces by their public
 * URL, so that is the production path). `turns` is how many earlier prompts the session
 * holds; `run` is how many assistant messages the watched run has produced.
 *
 *   bun benchmarks/platform/bench-snapshot.ts [--name snapshot]
 */
import { createV2Runtime } from "../../packages/agent-runtime/src/v2";
import { CADDY_URL, PORTS, loadState, saveResult, workspaceHost } from "./lib/config";
import { summarize } from "./lib/load";

const state = loadState();
const upstream = `http://127.0.0.1:${PORTS.upstream}`;
const host = workspaceHost(state.subdomains.serverOnly[0]!);

/** Counts what crosses the wire for the snapshots made through it. */
function counting() {
  const totals = { requests: 0, bytes: 0 };
  const counted = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const body = await response.arrayBuffer();
    totals.requests += 1;
    totals.bytes += body.byteLength;
    return new Response(body, response);
  }) as typeof fetch;
  return { totals, fetch: counted };
}

const results: unknown[] = [];
console.log(
  "turns   run  messages  path    requests  bytes/snapshot  p50 ms   max ms   10-min run at 1 snapshot/s",
);

for (const [turns, assistant] of [
  [1, 8],
  [20, 8],
  [60, 8],
  [150, 8],
  [5, 50],
  [5, 200],
] as const) {
  const session = `ses_bench_${turns}_${assistant}`;
  const built = (await (
    await fetch(
      `${upstream}/__opencode?session=${session}&turns=${turns}&assistant=${assistant}&bytes=4096`,
      {
        method: "POST",
      },
    )
  ).json()) as { messages: number; lastUserMessageId: string };

  for (const [label, url, headers] of [
    ["direct", upstream, undefined],
    ["proxy", CADDY_URL, { Host: host }],
  ] as const) {
    const counter = counting();
    const runtime = createV2Runtime({
      url,
      directory: "/tmp/bench",
      password: null,
      headers,
      fetch: counter.fetch,
    });
    await runtime.snapshot(session, built.lastUserMessageId);
    counter.totals.requests = 0;
    counter.totals.bytes = 0;
    const samples: number[] = [];
    const rounds = 20;
    for (let round = 0; round < rounds; round += 1) {
      const started = performance.now();
      const snapshot = await runtime.snapshot(session, built.lastUserMessageId);
      samples.push(performance.now() - started);
      if (!snapshot.sessionExists) throw new Error("mock session missing");
    }
    const stats = summarize(samples);
    const requests = counter.totals.requests / rounds;
    const bytes = Math.round(counter.totals.bytes / rounds);
    const tenMinuteMb = Math.round((bytes * 600) / 1024 / 1024);
    results.push({
      turns,
      runMessages: assistant,
      messages: built.messages,
      path: label,
      requests,
      bytes,
      ms: stats,
      tenMinuteMb,
    });
    console.log(
      `${String(turns).padStart(5)}  ${String(assistant).padStart(4)}  ${String(built.messages).padStart(8)}  ${label.padEnd(6)}  ${String(requests).padStart(8)}  ${String(bytes).padStart(14)}  ${stats.p50.toFixed(2).padStart(7)}  ${stats.max.toFixed(2).padStart(7)}   ${tenMinuteMb} MB, ${requests * 600} requests`,
    );
  }
}

console.log(
  `\nsaved ${saveResult(process.argv.includes("--name") ? process.argv[process.argv.indexOf("--name") + 1]! : "snapshot", results)}`,
);
process.exit(0);

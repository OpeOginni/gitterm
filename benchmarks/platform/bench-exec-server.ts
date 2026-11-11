#!/usr/bin/env bun
/**
 * Stress test of the sandbox exec-server (packages/agent-runtime/src/sandbox/exec-server.ts),
 * the Node command server that Railway and AWS sandboxes run. It starts the real server
 * source in a memory-limited container, the way those providers do, and checks command
 * latency, output limits, timeouts, file transfer and memory under load.
 *
 *   bun benchmarks/platform/bench-exec-server.ts [--image node:22-alpine] [--memory 512m] [--name exec-server]
 *
 * Standalone: needs Docker only, not the rig. The container is removed at the end.
 */
import { EXEC_SERVER_SOURCE } from "../../packages/agent-runtime/src/sandbox/exec-server";
import { saveResult } from "./lib/config";
import { load, row, summarize } from "./lib/load";

const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1]!;
};
const image = flag("image", "node:22-alpine");
const memory = flag("memory", "512m");
const CONTAINER = `gitterm-bench-exec-${process.pid}`;
const PORT = 18080;
const TOKEN = "bench-exec-token";
const base = `http://127.0.0.1:${PORT}`;
const auth = { "x-gitterm-token": TOKEN };
const results: Record<string, unknown> = {};

const docker = (...args: string[]) =>
  Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });

async function start() {
  docker("rm", "-f", CONTAINER);
  const started = docker(
    "run", "-d", "--name", CONTAINER, "--memory", memory, "--pids-limit", "1024",
    "-p", `127.0.0.1:${PORT}:8080`,
    "-e", "PORT=8080", "-e", `GITTERM_EXEC_TOKEN=${TOKEN}`, "-e", `GITTERM_EXEC_SERVER=${EXEC_SERVER_SOURCE}`,
    image, "sh", "-c", 'node -e "$GITTERM_EXEC_SERVER"',
  ); // prettier-ignore
  if (started.exitCode !== 0) throw new Error(started.stderr.toString());
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("exec-server did not start");
}

const state = () => {
  const out = docker("inspect", "-f", "{{.State.Running}} {{.State.OOMKilled}}", CONTAINER)
    .stdout.toString()
    .trim();
  const [running, oomKilled] = out.split(" ");
  return { running: running === "true", oomKilled: oomKilled === "true" };
};
const memoryMb = () => {
  const out = docker(
    "stats",
    "--no-stream",
    "--format",
    "{{.MemUsage}}",
    CONTAINER,
  ).stdout.toString();
  return out.split("/")[0]?.trim() ?? "?";
};

type RunResult = { exitCode: number; stdout: string; stderr: string };
async function run(command: string, timeoutMs?: number) {
  const started = performance.now();
  const response = await fetch(`${base}/run`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ command, cwd: "/tmp", timeoutMs }),
  });
  const body = response.ok ? ((await response.json()) as RunResult) : null;
  return { status: response.status, ms: Math.round(performance.now() - started), body };
}

try {
  await start();
  console.log(`exec-server in ${image}, memory limit ${memory}`);

  console.log("\n== command round trip: `echo ok`");
  const latency = [];
  for (const concurrency of [1, 16, 64]) {
    const result = await load({
      request: () => ({
        url: `${base}/run`,
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ command: "echo ok" }),
      }),
      concurrency,
      durationMs: 3000,
    });
    latency.push(result);
    console.log(row("  POST /run", result));
  }
  results.latency = latency;

  console.log("\n== output size: how much of a command's stdout comes back");
  const output = [];
  for (const bytes of [1_024, 1_048_576, 16_777_216, 100_000_000]) {
    const result = await run(`head -c ${bytes} /dev/zero | tr '\\0' x`, 60_000);
    const returned = result.body?.stdout.length ?? 0;
    const line = {
      produced: bytes,
      returned,
      truncated: returned < bytes,
      ms: result.ms,
      status: result.status,
    };
    output.push(line);
    console.log(
      `  produced ${String(bytes).padStart(10)} B  returned ${String(returned).padStart(10)} B  ${result.ms} ms${line.truncated ? "  TRUNCATED, no flag in the response" : ""}`,
    );
  }
  results.output = output;

  console.log("\n== timeouts: when does the response arrive");
  const timeouts = [];
  for (const [label, command, timeoutMs, expectedMs] of [
    ["command exceeds timeoutMs=1000", "sleep 8; echo late", 1000, 1000],
    ["command backgrounds a process", "sleep 6 & echo started", 30_000, 0],
  ] as const) {
    const result = await run(command, timeoutMs);
    const line = {
      case: label,
      command,
      timeoutMs,
      expectedMs,
      actualMs: result.ms,
      exitCode: result.body?.exitCode,
    };
    timeouts.push(line);
    console.log(
      `  ${label.padEnd(34)} expected ~${expectedMs} ms, answered after ${result.ms} ms (exit ${line.exitCode})`,
    );
  }
  const orphans = (await run("ps | grep -c '[s]leep'")).body?.stdout.trim();
  console.log(`  sleep processes left in the sandbox afterwards (running or defunct): ${orphans}`);
  results.timeouts = { cases: timeouts, orphans };

  console.log("\n== file transfer: PUT then GET /file");
  const files = [];
  for (const size of [1_048_576, 16_777_216, 31 * 1_048_576, 33 * 1_048_576]) {
    const data = new Uint8Array(size).fill(100);
    let put = { status: 0, ms: 0 };
    try {
      const started = performance.now();
      const response = await fetch(`${base}/file?path=/tmp/bench-${size}`, {
        method: "PUT",
        headers: auth,
        body: data,
      });
      await response.arrayBuffer();
      put = { status: response.status, ms: performance.now() - started };
    } catch {
      put = { status: -1, ms: 0 };
    }
    let get = { status: 0, ms: 0, bytes: 0 };
    if (put.status === 200) {
      const started = performance.now();
      const response = await fetch(`${base}/file?path=/tmp/bench-${size}`, { headers: auth });
      const bytes = (await response.arrayBuffer()).byteLength;
      get = { status: response.status, ms: performance.now() - started, bytes };
    }
    const mbps = (ms: number) => (ms ? Math.round(size / 1024 / 1024 / (ms / 1000)) : 0);
    const line = {
      size,
      putStatus: put.status,
      putMBps: mbps(put.ms),
      getStatus: get.status,
      getMBps: mbps(get.ms),
      intact: get.bytes === size,
    };
    files.push(line);
    console.log(
      `  ${String(Math.round(size / 1_048_576)).padStart(3)} MiB  PUT ${put.status === -1 ? "connection reset" : put.status} ${line.putMBps} MB/s   GET ${get.status || "-"} ${line.getMBps} MB/s${put.status === 200 && !line.intact ? "  SIZE MISMATCH" : ""}`,
    );
  }
  results.files = files;

  console.log("\n== health while a large file is read (the read is synchronous)");
  await run("head -c 300000000 /dev/zero > /tmp/big", 60_000);
  const probes: number[] = [];
  let reading = true;
  const read = fetch(`${base}/file?path=/tmp/big`, { headers: auth })
    .then((response) => response.arrayBuffer())
    .catch(() => null)
    .finally(() => (reading = false));
  while (reading) {
    const started = performance.now();
    await fetch(`${base}/healthz`)
      .then((response) => response.text())
      .catch(() => null);
    probes.push(performance.now() - started);
    await Bun.sleep(5);
  }
  await read;
  const health = summarize(probes);
  console.log(
    `  /healthz during a 300 MB GET: p50 ${health.p50} ms, max ${health.max} ms; container ${JSON.stringify(state())}, memory ${memoryMb()}`,
  );
  results.healthDuringRead = { health, state: state(), memory: memoryMb() };

  console.log("\n== memory: parallel commands that each print 16 MiB");
  const parallel = [];
  for (const count of [8, 32]) {
    if (!state().running) await start();
    const started = performance.now();
    const answers = await Promise.all(
      Array.from({ length: count }, () =>
        run("head -c 16000000 /dev/zero | tr '\\0' x", 60_000).catch(() => null),
      ),
    );
    const ok = answers.filter((answer) => answer?.status === 200).length;
    const line = {
      commands: count,
      answered: ok,
      ms: Math.round(performance.now() - started),
      ...state(),
      memory: state().running ? memoryMb() : "-",
    };
    parallel.push(line);
    console.log(
      `  ${String(count).padStart(3)} commands  ${ok} answered in ${line.ms} ms  running=${line.running} oomKilled=${line.oomKilled} memory ${line.memory}`,
    );
  }
  results.parallel = parallel;

  console.log(`\nsaved ${saveResult(flag("name", "exec-server"), results)}`);
} finally {
  docker("rm", "-f", CONTAINER);
}

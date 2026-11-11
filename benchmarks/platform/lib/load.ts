/** Closed-loop HTTP load generator: `concurrency` workers issue requests back to back. */

export type RequestSpec = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
};

export type LoadOptions = {
  /** Called once per request with a global counter, so a run can spread over many hosts. */
  request: (index: number) => RequestSpec;
  concurrency: number;
  durationMs: number;
  /** Requests during warmup are sent but not recorded. */
  warmupMs?: number;
  /** Anything else counts as an error. Defaults to 200. */
  expectStatus?: number;
};

export type Latency = {
  mean: number;
  p50: number;
  p90: number;
  p99: number;
  p999: number;
  max: number;
};

export type LoadResult = {
  concurrency: number;
  requests: number;
  errors: number;
  statuses: Record<string, number>;
  rps: number;
  /** Response body bytes per second. */
  bytesPerSecond: number;
  latencyMs: Latency;
};

export function summarize(samples: number[]): Latency {
  if (samples.length === 0) return { mean: 0, p50: 0, p90: 0, p99: 0, p999: 0, max: 0 };
  const sorted = Float64Array.from(samples).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  let sum = 0;
  for (const value of sorted) sum += value;
  return {
    mean: round(sum / sorted.length),
    p50: round(at(0.5)),
    p90: round(at(0.9)),
    p99: round(at(0.99)),
    p999: round(at(0.999)),
    max: round(sorted[sorted.length - 1]!),
  };
}

/**
 * Waits until few sockets are left in TIME_WAIT. A path that opens a connection per
 * request can use up the ephemeral ports (about 16k on macOS, held 30 s each), and the
 * next run would then fail for a reason that has nothing to do with what it measures.
 */
export async function drain(limit = 1500) {
  const command =
    process.platform === "darwin"
      ? ["netstat", "-an", "-p", "tcp"]
      : ["ss", "-tan", "state", "time-wait"];
  const deadline = Date.now() + 90_000;
  let told = false;
  for (;;) {
    let waiting = 0;
    try {
      const out = Bun.spawnSync(command).stdout.toString();
      waiting = out.split("\n").filter((line) => /TIME_WAIT|^\S+\s+\d/.test(line)).length;
    } catch {
      return; // No tool to count them with: carry on.
    }
    if (waiting < limit) return;
    if (Date.now() > deadline) {
      console.warn(`  still ${waiting} sockets in TIME_WAIT after 90 s; continuing`);
      return;
    }
    if (!told) console.log(`  waiting for ${waiting} closed sockets to clear ...`);
    told = true;
    await Bun.sleep(1000);
  }
}

export async function load(options: LoadOptions): Promise<LoadResult> {
  await drain();
  const expect = options.expectStatus ?? 200;
  const warmupUntil = performance.now() + (options.warmupMs ?? 0);
  const stopAt = warmupUntil + options.durationMs;
  const samples: number[] = [];
  const statuses: Record<string, number> = {};
  let errors = 0;
  let bytes = 0;
  let counter = 0;

  const worker = async () => {
    while (performance.now() < stopAt) {
      const spec = options.request(counter++);
      const started = performance.now();
      let status = "network";
      let size = 0;
      try {
        const response = await fetch(spec.url, {
          method: spec.method,
          headers: spec.headers,
          body: spec.body,
          redirect: "manual",
        });
        size = (await response.arrayBuffer()).byteLength;
        status = String(response.status);
      } catch {}
      const ended = performance.now();
      if (started < warmupUntil) continue;
      samples.push(ended - started);
      bytes += size;
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (status !== String(expect)) errors += 1;
    }
  };

  await Promise.all(Array.from({ length: options.concurrency }, worker));
  // Workers finish the request they started before the deadline, so use the real window.
  const seconds = (performance.now() - warmupUntil) / 1000;
  return {
    concurrency: options.concurrency,
    requests: samples.length,
    errors,
    statuses,
    rps: Math.round(samples.length / seconds),
    bytesPerSecond: Math.round(bytes / seconds),
    latencyMs: summarize(samples),
  };
}

export function row(label: string, result: LoadResult): string {
  const l = result.latencyMs;
  return [
    label.padEnd(34),
    `c=${String(result.concurrency).padEnd(4)}`,
    `${String(result.rps).padStart(7)} rps`,
    `p50 ${l.p50.toFixed(2).padStart(7)}`,
    `p90 ${l.p90.toFixed(2).padStart(7)}`,
    `p99 ${l.p99.toFixed(2).padStart(7)}`,
    `max ${l.max.toFixed(1).padStart(7)} ms`,
    result.errors ? `errors ${result.errors} ${JSON.stringify(result.statuses)}` : "",
  ].join("  ");
}

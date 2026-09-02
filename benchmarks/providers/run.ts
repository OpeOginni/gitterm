import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createGittermClient,
  type ProviderKey,
  type WorkspaceProviderSelection,
} from "../../packages/sdk/src/index.ts";
import {
  buildWorkspaceBenchmarkCommand,
  parseWorkspaceBenchmarkLog,
  type WorkspaceBenchmarkResult,
} from "./workload.ts";

const ALL_PROVIDERS = [
  "railway",
  "aws",
  "e2b",
  "daytona",
  "cloudflare",
  "vercel",
  "ascii",
  "exedev",
] as const satisfies readonly ProviderKey[];
const HOSTED_PROVIDERS = [
  "railway",
  "e2b",
  "daytona",
  "vercel",
] as const satisfies readonly ProviderKey[];

type ProviderBenchmarkResult = {
  provider: ProviderKey;
  recordedAt: string;
  workspaceId?: string;
  controlPlane: {
    createApiMs?: number;
    coldStartReadyMs?: number;
    workspaceBenchmarkMs?: number;
    pauseMs?: number;
    restartApiMs?: number;
    restartReadyMs?: number;
    terminateMs?: number;
  };
  workspace?: WorkspaceBenchmarkResult;
  cleanup: "not-needed" | "terminated" | "failed";
  error?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function argument(name: string): string | undefined {
  const args = process.argv.slice(2);
  const inline = args.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function selectedProviders(): ProviderKey[] {
  const args = process.argv.slice(2);
  const hosted = args.includes("--hosted");
  const selection = argument("--provider");

  if (hosted) {
    if (!selection) return [...HOSTED_PROVIDERS];
    if (!HOSTED_PROVIDERS.includes(selection as (typeof HOSTED_PROVIDERS)[number])) {
      throw new Error(`Not a hosted provider: ${selection}`);
    }
    return [selection as ProviderKey];
  }
  if (args.includes("--all")) {
    if (process.env.CI) throw new Error("--all is local-only");
    return [...ALL_PROVIDERS];
  }
  if (!selection || !ALL_PROVIDERS.includes(selection as ProviderKey)) {
    throw new Error("Select one provider with --provider, use --hosted, or use local-only --all");
  }
  return [selection as ProviderKey];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round(performance.now() - startedAt) };
}

async function benchmarkProvider(provider: ProviderKey): Promise<ProviderBenchmarkResult> {
  const serverUrl = requiredEnv("GITTERM_SERVER_URL");
  const token = requiredEnv("GITTERM_API_TOKEN");
  const repo = requiredEnv("GITTERM_E2E_REPO");
  const agent = process.env.GITTERM_E2E_AGENT?.trim() || "opencode";
  const timeoutMs = Number(process.env.GITTERM_BENCHMARK_TIMEOUT_MS ?? 15 * 60_000);
  const cpuIterations = Number(process.env.GITTERM_BENCHMARK_CPU_ITERATIONS ?? 20_000_000);
  const diskSizeMiB = Number(process.env.GITTERM_BENCHMARK_DISK_MIB ?? 64);
  const client = createGittermClient({ serverUrl, token });
  const result: ProviderBenchmarkResult = {
    provider,
    recordedAt: new Date().toISOString(),
    controlPlane: {},
    cleanup: "not-needed",
  };
  let workspaceId: string | undefined;
  let terminated = false;

  console.log(`\nBenchmarking ${provider}`);
  try {
    const catalog = await client.catalog.workspaceOptions();
    const configuredProvider = catalog.providers.find((entry) => entry.type === provider);
    if (!configuredProvider) throw new Error(`${provider} is not enabled on ${serverUrl}`);
    if (!configuredProvider.agentKeys.includes(agent)) {
      throw new Error(`${provider} does not support agent ${agent}`);
    }

    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const coldStartStartedAt = performance.now();
    const created = await timed(() =>
      client.workspaces.create({
        idempotencyKey: `provider-benchmark-${provider}-${runId}`,
        name: `benchmark-${provider}-${runId}`,
        repo,
        agent,
        provider: { type: provider } as WorkspaceProviderSelection,
        setup: {
          afterAgent: [buildWorkspaceBenchmarkCommand({ cpuIterations, diskSizeMiB })],
        },
      }),
    );
    result.controlPlane.createApiMs = created.durationMs;
    workspaceId = created.value.workspace.id;
    result.workspaceId = workspaceId;

    await client.workspaces.ensureRunning(workspaceId, { timeoutMs });
    result.controlPlane.coldStartReadyMs = Math.round(performance.now() - coldStartStartedAt);

    const setup = await client.workspaces.waitForSetup(workspaceId, { timeoutMs });
    if (setup.startedAt && setup.finishedAt) {
      result.controlPlane.workspaceBenchmarkMs =
        new Date(setup.finishedAt).getTime() - new Date(setup.startedAt).getTime();
    }
    result.workspace = parseWorkspaceBenchmarkLog(setup.log);

    const paused = await timed(() => client.workspaces.pause(workspaceId!));
    result.controlPlane.pauseMs = paused.durationMs;

    const restartStartedAt = performance.now();
    const restarted = await timed(() => client.workspaces.restart(workspaceId!));
    result.controlPlane.restartApiMs = restarted.durationMs;
    await client.workspaces.ensureRunning(workspaceId, { timeoutMs });
    result.controlPlane.restartReadyMs = Math.round(performance.now() - restartStartedAt);

    const terminatedResult = await timed(() => client.workspaces.terminate(workspaceId!));
    result.controlPlane.terminateMs = terminatedResult.durationMs;
    result.cleanup = "terminated";
    terminated = true;
  } catch (error) {
    result.error = errorMessage(error);
  } finally {
    if (workspaceId && !terminated) {
      try {
        await client.workspaces.terminate(workspaceId);
        result.cleanup = "terminated";
      } catch (cleanupError) {
        result.cleanup = "failed";
        result.error = `${result.error ?? "Benchmark failed"}\nCleanup failed: ${errorMessage(cleanupError)}`;
      }
    }
  }

  return result;
}

async function main() {
  requiredEnv("GITTERM_SERVER_URL");
  requiredEnv("GITTERM_API_TOKEN");
  requiredEnv("GITTERM_E2E_REPO");
  const providers = selectedProviders();
  const results: ProviderBenchmarkResult[] = [];
  for (const provider of providers) results.push(await benchmarkProvider(provider));

  const output = JSON.stringify({ version: 1, results }, null, 2);
  console.log(`\n${output}`);
  const outputPath = argument("--output");
  if (outputPath) {
    const absolutePath = resolve(outputPath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await Bun.write(absolutePath, `${output}\n`);
    console.log(`Wrote benchmark results to ${absolutePath}`);
  }

  if (results.some((result) => result.error)) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

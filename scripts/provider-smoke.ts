import { join } from "node:path";
import dotenv from "dotenv";
import {
  createGittermClient,
  type ProviderKey,
  type WorkspaceProviderSelection,
} from "../packages/sdk/src/index.ts";

dotenv.config({ path: join(import.meta.dir, ".env") });

const PROVIDERS = [
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
const MAX_ENSURE_RUNNING_TIMEOUT_MS = 360_000;

type StepResult = {
  name: string;
  durationMs: number;
};

type ProviderResult = {
  provider: ProviderKey;
  workspaceId?: string;
  steps: StepResult[];
  cleanup: "not-needed" | "terminated" | "failed";
  error?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function selectedProviders(): ProviderKey[] {
  const args = process.argv.slice(2);
  const hostedOnly = args.includes("--hosted");
  const providerFlag = args.find((arg) => arg.startsWith("--provider="));
  const providerIndex = args.indexOf("--provider");
  const selection =
    providerFlag?.slice("--provider=".length) ??
    (providerIndex >= 0 ? args[providerIndex + 1] : undefined) ??
    process.env.GITTERM_E2E_PROVIDERS;

  if (hostedOnly) {
    if (args.includes("--all") || selection === "all") {
      throw new Error("--hosted cannot be combined with --all");
    }
    if (!selection) return [...HOSTED_PROVIDERS];
  }
  if (args.includes("--all") || selection === "all") {
    if (process.env.CI) throw new Error("--all is local-only; use --hosted in GitHub Actions");
    return [...PROVIDERS];
  }
  if (!selection) {
    throw new Error("Select providers with --provider e2b,daytona, --hosted, or --all");
  }

  const providers = selection
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  const unknown = providers.filter(
    (provider): provider is string => !PROVIDERS.includes(provider as ProviderKey),
  );
  if (unknown.length > 0) throw new Error(`Unknown providers: ${unknown.join(", ")}`);
  if (providers.length === 0) throw new Error("At least one provider is required");
  const selected = [...new Set(providers)] as ProviderKey[];
  const nonHosted = selected.filter(
    (provider) => !HOSTED_PROVIDERS.some((hosted) => hosted === provider),
  );
  if (hostedOnly && nonHosted.length > 0) {
    throw new Error(`Not a hosted provider: ${nonHosted.join(", ")}`);
  }
  return selected;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function step<T>(
  results: StepResult[],
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  process.stdout.write(`  ${name}... `);
  try {
    const result = await operation();
    const durationMs = Math.round(performance.now() - startedAt);
    results.push({ name, durationMs });
    console.log(`ok (${(durationMs / 1000).toFixed(1)}s)`);
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    results.push({ name, durationMs });
    console.log(`failed (${(durationMs / 1000).toFixed(1)}s)`);
    throw error;
  }
}

async function runCli(args: string[]): Promise<unknown> {
  const env = { ...process.env };
  for (const key of [
    "WORKSPACE_API_URL",
    "WORKSPACE_AUTH_TOKEN",
    "WORKSPACE_ID",
    "WORKSPACE_AGENT_AUTH_TOKEN",
    "WORKSPACE_SETUP_AUTH_TOKEN",
  ]) {
    delete env[key];
  }

  const processResult = Bun.spawn(["bun", "packages/cli/src/index.ts", ...args, "--json"], {
    cwd: import.meta.dir + "/..",
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`CLI exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`CLI returned invalid JSON: ${stdout.trim()}`);
  }
}

async function runProvider(provider: ProviderKey): Promise<ProviderResult> {
  const serverUrl = requiredEnv("GITTERM_SERVER_URL");
  const token = requiredEnv("GITTERM_API_TOKEN");
  const repo = requiredEnv("GITTERM_E2E_REPO");
  const agent = process.env.GITTERM_E2E_AGENT?.trim() || "opencode";
  const model = process.env.GITTERM_E2E_MODEL?.trim() || "opencode/big-pickle";
  const models =
    model === "opencode/big-pickle"
      ? { providers: { opencode: { source: "apiKey" as const, apiKey: "public" } } }
      : undefined;
  // Overall per-step budget; must exceed the setup wrapper's 300s readiness
  // probe so probe failures can report before the smoke gives up.
  const timeoutMs = Number(process.env.GITTERM_E2E_TIMEOUT_MS ?? MAX_ENSURE_RUNNING_TIMEOUT_MS);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_ENSURE_RUNNING_TIMEOUT_MS
  ) {
    throw new Error(
      `GITTERM_E2E_TIMEOUT_MS must be an integer between 1000 and ${MAX_ENSURE_RUNNING_TIMEOUT_MS}`,
    );
  }
  const runTimeoutMs = Number(process.env.GITTERM_E2E_RUN_TIMEOUT_MS ?? 30 * 60_000);
  // ensureRunning is a server-held wait capped at 240s by API validation
  // (Bun's ~255s idle timeout); the setup wait polls client-side, so it can
  // use the full timeout to outlast the workspace's 300s readiness probe.
  const ensureRunningTimeoutMs = Math.min(timeoutMs, 240_000);
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const client = createGittermClient({ serverUrl, token });
  const result: ProviderResult = { provider, steps: [], cleanup: "not-needed" };
  let workspaceId: string | undefined;
  let terminated = false;

  console.log(`\n${provider}`);
  try {
    await step(result.steps, "authenticate SDK", () => client.auth.status());
    const catalogProvider = await step(result.steps, "validate catalog", async () => {
      const catalog = await client.catalog.workspaceOptions();
      const configuredProvider = catalog.providers.find((entry) => entry.type === provider);
      if (!configuredProvider) {
        throw new Error(
          `${provider} is unavailable on ${serverUrl} (catalog providers: ${catalog.providers.map((entry) => entry.type).join(", ") || "none"})`,
        );
      }
      if (!configuredProvider.agentKeys.includes(agent)) {
        throw new Error(`${provider} does not support agent ${agent}`);
      }
      return configuredProvider;
    });
    // Providers without workspace -> API access (e.g. Daytona Tier 1/2) can't
    // run the scoped CLI inside the workspace; exercise plain setup commands
    // instead and rely on server-side polling to deliver the outcome.
    const workspaceApiAccess = catalogProvider.workspaceApiAccess !== false;
    if (!workspaceApiAccess) {
      console.log(
        "  note: provider org is below Tier 3 (no workspace API access) - scoped CLI checks skipped",
      );
    }

    const created = await step(result.steps, "create workspace with SDK", () =>
      client.workspaces.create({
        idempotencyKey: `provider-smoke-${provider}-${runId}`,
        name: `e2e-${provider}-${runId}`,
        repo,
        agent,
        provider: { type: provider } as WorkspaceProviderSelection,
        models,
        setup: {
          afterAgent: [
            (workspaceApiAccess
              ? [
                  "set -eu",
                  'echo "=== marker: env ($(date -u +%H:%M:%SZ))"',
                  'env | grep -E "^WORKSPACE_(API_URL|SETUP_PORT)=" || echo "missing workspace env"',
                  'echo "=== marker: cli ($(date -u +%H:%M:%SZ))"',
                  "command -v gitterm && timeout 15 gitterm --version",
                  'echo "=== marker: api reachability ($(date -u +%H:%M:%SZ))"',
                  'curl -sS -m 10 -o /dev/null -w "api http %{http_code}\\n" "$WORKSPACE_API_URL" || echo "api unreachable"',
                  'echo "=== marker: workspace info ($(date -u +%H:%M:%SZ))"',
                  `workspace_ready=0; for attempt in $(seq 1 60); do workspace_info=$(timeout 30 gitterm workspace info --json); printf "%s\\n" "$workspace_info"; if printf "%s\\n" "$workspace_info" | grep -Eq '"status":[[:space:]]*"running"'; then workspace_ready=1; break; fi; sleep 2; done; [ "$workspace_ready" -eq 1 ] || { echo "workspace did not reach running status"; exit 1; }`,
                  'echo "=== marker: ports list ($(date -u +%H:%M:%SZ))"',
                  "timeout 30 gitterm ports list --json",
                  'echo "=== marker: ports open ($(date -u +%H:%M:%SZ))"',
                  "timeout 45 gitterm ports open 43117 --name gitterm-e2e --json",
                  'echo "=== marker: ports close ($(date -u +%H:%M:%SZ))"',
                  "timeout 30 gitterm ports close 43117 --json",
                  'echo "=== marker: done ($(date -u +%H:%M:%SZ))"',
                ]
              : [
                  "set -eu",
                  'echo "=== marker: env ($(date -u +%H:%M:%SZ))"',
                  'env | grep -E "^WORKSPACE_(API_URL|SETUP_PORT)=" || echo "missing workspace env"',
                  'echo "=== marker: plain setup ($(date -u +%H:%M:%SZ))"',
                  "git rev-parse --short HEAD",
                  'echo "=== marker: done ($(date -u +%H:%M:%SZ))"',
                ]
            ).join("\n"),
          ],
        },
      }),
    );
    workspaceId = created.workspace.id;
    result.workspaceId = workspaceId;

    const running = await step(result.steps, "wait for running workspace", () =>
      client.workspaces.ensureRunning(workspaceId!, { timeoutMs: ensureRunningTimeoutMs }),
    );
    if (running.workspace.status !== "running") {
      throw new Error(`Expected running workspace, received ${running.workspace.status}`);
    }
    if (running.runtime.providerKey !== provider) {
      throw new Error(
        `Expected runtime provider ${provider}, received ${running.runtime.providerKey}`,
      );
    }

    const setup = await step(
      result.steps,
      workspaceApiAccess ? "exercise scoped CLI" : "run setup (scoped CLI unavailable)",
      () => client.workspaces.waitForSetup(workspaceId!, { timeoutMs }),
    );
    if (setup.status !== "succeeded") throw new Error(`Setup finished with ${setup.status}`);

    const cliWorkspace = (await step(result.steps, "read workspace with account CLI", () =>
      runCli(["workspace", "get", workspaceId!]),
    )) as { id?: string };
    if (cliWorkspace.id !== workspaceId) throw new Error("CLI returned the wrong workspace");

    const agentRun = await step(result.steps, "create agent run with SDK", () =>
      client.runs.create({
        workspace: workspaceId!,
        idempotencyKey: `provider-smoke-run-${provider}-${runId}`,
        title: `Provider smoke test: ${provider}`,
        prompt: "Respond with exactly GITTERM_E2E_OK and no other text.",
        model,
        waitForSetup: true,
        setupTimeoutMs: timeoutMs,
      }),
    );
    const completedRun = await step(result.steps, "wait for agent run", () =>
      client.runs.wait(agentRun, { timeoutMs: runTimeoutMs }),
    );
    if (completedRun.status !== "completed") {
      throw new Error(
        `Agent run finished with ${completedRun.status}: ${completedRun.error ?? ""}`,
      );
    }
    if (!completedRun.finalText?.includes("GITTERM_E2E_OK")) {
      const messages = await client.runs.messages(agentRun).catch((error) => [
        {
          error: error instanceof Error ? error.message : String(error),
        },
      ]);
      throw new Error(
        `Agent run returned unexpected text for ${model}: ${JSON.stringify({
          status: completedRun.status,
          error: completedRun.error,
          finalText: completedRun.finalText,
          messages,
        })}`,
      );
    }

    await step(result.steps, "pause with account CLI", () =>
      runCli(["workspace", "pause", workspaceId!]),
    );
    await step(result.steps, "restart with account CLI", () =>
      runCli(["workspace", "restart", workspaceId!]),
    );
    await step(result.steps, "verify restarted workspace", () =>
      client.workspaces.ensureRunning(workspaceId!, { timeoutMs: ensureRunningTimeoutMs }),
    );
    await step(result.steps, "terminate with account CLI", () =>
      runCli(["workspace", "terminate", workspaceId!, "--yes"]),
    );
    terminated = true;
    result.cleanup = "terminated";

    const terminatedWorkspace = await step(result.steps, "verify termination", () =>
      client.workspaces.get(workspaceId!),
    );
    if (terminatedWorkspace.status !== "terminated") {
      throw new Error(`Expected terminated workspace, received ${terminatedWorkspace.status}`);
    }
  } catch (error) {
    result.error = errorMessage(error);
  } finally {
    if (workspaceId && !terminated) {
      try {
        await step(result.steps, "cleanup workspace", () =>
          client.workspaces.terminate(workspaceId!),
        );
        result.cleanup = "terminated";
      } catch (cleanupError) {
        result.cleanup = "failed";
        result.error = `${result.error ?? "Provider test failed"}\nCleanup failed: ${errorMessage(cleanupError)}`;
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
  const results: ProviderResult[] = [];

  console.log(`Running provider smoke tests sequentially: ${providers.join(", ")}`);
  for (const provider of providers) results.push(await runProvider(provider));

  console.log("\nProvider smoke summary");
  for (const result of results) {
    const durationMs = result.steps.reduce((total, current) => total + current.durationMs, 0);
    console.log(
      `${result.error ? "FAIL" : "PASS"} ${result.provider} (${(durationMs / 1000).toFixed(1)}s, cleanup: ${result.cleanup})`,
    );
    if (result.error) console.error(result.error);
  }

  if (results.some((result) => result.error)) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

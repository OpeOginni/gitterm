import {
  createGittermClient,
  type ProviderKey,
  type WorkspaceProviderSelection,
} from "../packages/sdk/src/index.ts";

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

const HOSTED_PROVIDERS = ["railway", "e2b", "daytona"] as const satisfies readonly ProviderKey[];
const MAX_ENSURE_RUNNING_TIMEOUT_MS = 240_000;

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
  const nonHosted = selected.filter((provider) => !HOSTED_PROVIDERS.includes(provider));
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
  // Keep this in sync with workspace.ensureRunning's API validation limit.
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
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const client = createGittermClient({ serverUrl, token });
  const result: ProviderResult = { provider, steps: [], cleanup: "not-needed" };
  let workspaceId: string | undefined;
  let terminated = false;

  console.log(`\n${provider}`);
  try {
    await step(result.steps, "authenticate SDK", () => client.auth.status());
    await step(result.steps, "validate catalog", async () => {
      const catalog = await client.catalog.workspaceOptions();
      const configuredProvider = catalog.providers.find((entry) => entry.type === provider);
      if (!configuredProvider) throw new Error(`${provider} is not enabled on ${serverUrl}`);
      if (!configuredProvider.agentKeys.includes(agent)) {
        throw new Error(`${provider} does not support agent ${agent}`);
      }
    });

    const created = await step(result.steps, "create workspace with SDK", () =>
      client.workspaces.create({
        idempotencyKey: `provider-smoke-${provider}-${runId}`,
        name: `e2e-${provider}-${runId}`,
        repo,
        agent,
        provider: { type: provider } as WorkspaceProviderSelection,
        setupCommands: [
          [
            "set -eu",
            "gitterm workspace info --json",
            "gitterm ports list --json",
            "gitterm ports open 43117 --name gitterm-e2e --json",
            "gitterm ports close 43117 --json",
          ].join("; "),
        ],
      }),
    );
    workspaceId = created.workspace.id;
    result.workspaceId = workspaceId;

    const running = await step(result.steps, "wait for running workspace", () =>
      client.workspaces.ensureRunning(workspaceId!, { timeoutMs }),
    );
    if (running.workspace.status !== "running") {
      throw new Error(`Expected running workspace, received ${running.workspace.status}`);
    }
    if (running.runtime.providerKey !== provider) {
      throw new Error(
        `Expected runtime provider ${provider}, received ${running.runtime.providerKey}`,
      );
    }

    const setup = await step(result.steps, "exercise scoped CLI", () =>
      client.workspaces.waitForSetup(workspaceId!, { timeoutMs }),
    );
    if (setup.status !== "succeeded") throw new Error(`Setup finished with ${setup.status}`);

    const cliWorkspace = (await step(result.steps, "read workspace with account CLI", () =>
      runCli(["workspace", "get", workspaceId!]),
    )) as { id?: string };
    if (cliWorkspace.id !== workspaceId) throw new Error("CLI returned the wrong workspace");

    const agentRun = await step(result.steps, "create agent run with SDK", () =>
      client.runs.create({
        workspaceId: workspaceId!,
        idempotencyKey: `provider-smoke-run-${provider}-${runId}`,
        title: `Provider smoke test: ${provider}`,
        prompt: "Respond with exactly GITTERM_E2E_OK and no other text.",
        waitForSetup: true,
        setupTimeoutMs: timeoutMs,
      }),
    );
    const completedRun = await step(result.steps, "wait for agent run", () =>
      client.runs.wait(workspaceId!, agentRun.id, { timeoutMs: runTimeoutMs }),
    );
    if (completedRun.status !== "completed") {
      throw new Error(
        `Agent run finished with ${completedRun.status}: ${completedRun.error ?? ""}`,
      );
    }
    if (!completedRun.finalText?.includes("GITTERM_E2E_OK")) {
      throw new Error(`Agent run returned unexpected text: ${completedRun.finalText ?? "<empty>"}`);
    }

    await step(result.steps, "pause with account CLI", () =>
      runCli(["workspace", "pause", workspaceId!]),
    );
    await step(result.steps, "restart with account CLI", () =>
      runCli(["workspace", "restart", workspaceId!]),
    );
    await step(result.steps, "verify restarted workspace", () =>
      client.workspaces.ensureRunning(workspaceId!, { timeoutMs }),
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

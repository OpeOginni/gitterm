import { join } from "node:path";
import dotenv from "dotenv";
import {
  createDirectGittermClient,
  type DirectGittermClient,
  type DirectModelCredential,
  type DirectProviderConfig,
  type DirectRun,
  type DirectWorkspace,
} from "../packages/sdk/src/direct/index.ts";

dotenv.config({ path: join(import.meta.dir, ".env") });

const PROVIDERS = [
  "e2b",
  "daytona",
  "vercel",
  "ascii",
  "exedev",
  "railway",
] as const satisfies readonly DirectProviderConfig["type"][];
const STATUS_TIMEOUT_MS = 4 * 60_000;

type ProviderKey = (typeof PROVIDERS)[number];
type StepResult = { name: string; durationMs: number };
type ProviderResult = {
  provider: ProviderKey;
  workspaceId: string;
  steps: StepResult[];
  cleanup: "not-needed" | "terminated" | "failed";
  error?: string;
};
type SmokeSettings = {
  repo: string;
  branch?: string;
  checkoutRef?: string;
  baseCommit?: string;
  repositoryCredentials?: { username?: string; token: string };
  model: string;
  modelCredentials: DirectModelCredential[];
  timeoutMs: number;
  runTimeoutMs: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1_000) {
    throw new Error(`${name} must be an integer greater than or equal to 1000`);
  }
  return value;
}

function selectedProviders(): ProviderKey[] {
  const args = process.argv.slice(2);
  const providerFlag = args.find((arg) => arg.startsWith("--provider="));
  const providerIndex = args.indexOf("--provider");
  const selection =
    providerFlag?.slice("--provider=".length) ??
    (providerIndex >= 0 ? args[providerIndex + 1] : undefined) ??
    process.env.GITTERM_DIRECT_E2E_PROVIDERS;

  if (args.includes("--all") || selection === "all") {
    if (process.env.CI) throw new Error("--all is local-only; select one provider in CI");
    return [...PROVIDERS];
  }
  if (!selection) {
    throw new Error("Select providers with --provider e2b,daytona or --all");
  }

  const providers = selection
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  const unknown = providers.filter(
    (provider): provider is string => !PROVIDERS.includes(provider as ProviderKey),
  );
  if (unknown.length) throw new Error(`Unknown direct providers: ${unknown.join(", ")}`);
  if (!providers.length) throw new Error("At least one direct provider is required");
  return [...new Set(providers)] as ProviderKey[];
}

function providerConfig(provider: ProviderKey, timeoutMs: number): DirectProviderConfig {
  switch (provider) {
    case "e2b": {
      const size = optionalEnv("E2B_SIZE") ?? "standard";
      if (size !== "standard" && size !== "large") {
        throw new Error("E2B_SIZE must be standard or large");
      }
      return {
        type: "e2b",
        apiKey: requiredEnv("E2B_API_KEY"),
        size,
        templateId: optionalEnv("E2B_TEMPLATE_ID"),
        timeoutMs,
      };
    }
    case "daytona": {
      const target = optionalEnv("DAYTONA_TARGET") ?? "us";
      if (target !== "us" && target !== "eu") throw new Error("DAYTONA_TARGET must be us or eu");
      return {
        type: "daytona",
        apiKey: requiredEnv("DAYTONA_API_KEY"),
        target,
        image: optionalEnv("DAYTONA_IMAGE"),
      };
    }
    case "vercel":
      return {
        type: "vercel",
        apiToken: requiredEnv("VERCEL_API_TOKEN"),
        teamId: requiredEnv("VERCEL_TEAM_ID"),
        projectId: requiredEnv("VERCEL_PROJECT_ID"),
        image: optionalEnv("VERCEL_IMAGE"),
        runtime: "node24",
        timeoutMs,
      };
    case "ascii":
      return { type: "ascii", apiKey: requiredEnv("ASCII_API_KEY"), timeoutMs };
    case "exedev":
      return {
        type: "exedev",
        apiToken: requiredEnv("EXEDEV_API_TOKEN"),
        image: optionalEnv("EXEDEV_IMAGE"),
      };
    case "railway":
      return {
        type: "railway",
        apiToken: requiredEnv("RAILWAY_API_TOKEN"),
        projectId: requiredEnv("RAILWAY_PROJECT_ID"),
        environmentId: requiredEnv("RAILWAY_ENVIRONMENT_ID"),
        region: optionalEnv("RAILWAY_REGION"),
        image: optionalEnv("RAILWAY_IMAGE"),
      };
  }
}

function smokeSettings(): SmokeSettings {
  const repo = requiredEnv("GITTERM_E2E_REPO");
  const model = optionalEnv("GITTERM_E2E_MODEL") ?? "opencode/big-pickle";
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error('GITTERM_E2E_MODEL must use the "provider/model" format');
  }

  const modelApiKey = optionalEnv("GITTERM_MODEL_API_KEY");
  const repoToken = optionalEnv("GITTERM_E2E_REPO_TOKEN");
  const repoUsername = optionalEnv("GITTERM_E2E_REPO_USERNAME");
  if (repoUsername && !repoToken) {
    throw new Error("GITTERM_E2E_REPO_USERNAME requires GITTERM_E2E_REPO_TOKEN");
  }

  const runTimeoutMs = positiveIntegerEnv("GITTERM_E2E_RUN_TIMEOUT_MS", 30 * 60_000);
  const timeoutMs = Math.max(
    positiveIntegerEnv("GITTERM_E2E_TIMEOUT_MS", 6 * 60_000),
    runTimeoutMs + 60_000,
  );
  return {
    repo,
    branch: optionalEnv("GITTERM_E2E_BRANCH"),
    checkoutRef: optionalEnv("GITTERM_E2E_CHECKOUT_REF"),
    baseCommit: optionalEnv("GITTERM_E2E_BASE_COMMIT"),
    repositoryCredentials: repoToken
      ? { token: repoToken, ...(repoUsername ? { username: repoUsername } : {}) }
      : undefined,
    model,
    modelCredentials: modelApiKey
      ? [{ providerName: model.slice(0, separator), apiKey: modelApiKey }]
      : [],
    timeoutMs,
    runTimeoutMs,
  };
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

async function waitForWorkspaceStatus(
  client: DirectGittermClient,
  workspace: DirectWorkspace,
  expected: DirectWorkspace["status"],
): Promise<DirectWorkspace> {
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  let current = workspace;
  while (Date.now() < deadline) {
    current = await client.workspaces.status(current);
    if (current.status === expected) return current;
    if (current.status === "failed") {
      throw new Error(`Workspace failed while waiting for ${expected}`);
    }
    if (current.status === "terminated" && expected !== "terminated") {
      throw new Error(`Workspace terminated while waiting for ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for workspace status ${expected}; received ${current.status}`);
}

async function runProvider(
  provider: ProviderKey,
  config: DirectProviderConfig,
  settings: SmokeSettings,
): Promise<ProviderResult> {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const workspaceId = `direct-smoke-${provider}-${runId}`;
  const marker = `GITTERM_DIRECT_E2E_OK_${provider}_${crypto.randomUUID().replaceAll("-", "")}`;
  const client = createDirectGittermClient({ provider: config });
  const result: ProviderResult = {
    provider,
    workspaceId,
    steps: [],
    cleanup: "not-needed",
  };
  let workspace: DirectWorkspace | undefined;
  let activeRun: DirectRun | undefined;
  let terminated = false;

  console.log(`\n${provider}`);
  try {
    await step(result.steps, "validate direct provider", async () => {
      if (client.provider.name !== provider) {
        throw new Error(`Expected provider ${provider}, received ${client.provider.name}`);
      }
      if (client.provider.capabilities.persistence !== "supported") {
        throw new Error(`${provider} does not support the persistent smoke-test lifecycle`);
      }
    });

    workspace = await step(result.steps, "create workspace and run setup", () =>
      client.workspaces.create({
        id: workspaceId,
        lifecycle: "persistent",
        repo: settings.repo,
        branch: settings.branch,
        checkoutRef: settings.checkoutRef,
        baseCommit: settings.baseCommit,
        repositoryCredentials: settings.repositoryCredentials,
        modelCredentials: settings.modelCredentials,
        environmentVariables: {
          GITTERM_DIRECT_E2E_MARKER: marker,
          GITTERM_DIRECT_E2E_REPO: settings.repo,
          GITTERM_DIRECT_E2E_BASE_COMMIT: settings.baseCommit ?? "",
        },
        setupCommands: [
          [
            "set -eu",
            "test -d .git",
            'test "$(git rev-parse --is-inside-work-tree)" = "true"',
            'remote="$(git remote get-url origin)"',
            'expected="$GITTERM_DIRECT_E2E_REPO"',
            'test "$remote" = "$expected" || test "$remote" = "${expected%.git}.git"',
            'if [ -n "$GITTERM_DIRECT_E2E_BASE_COMMIT" ]; then test "$(git rev-parse HEAD)" = "$GITTERM_DIRECT_E2E_BASE_COMMIT"; fi',
            'printf "%s\n" "$GITTERM_DIRECT_E2E_MARKER" > .gitterm-direct-smoke',
          ].join("\n"),
        ],
        opencode: { config: { permission: { read: "allow", bash: "allow" } } },
      }),
    );

    workspace = await step(result.steps, "serialize workspace handle", async () => {
      const restored = JSON.parse(JSON.stringify(workspace)) as DirectWorkspace;
      if (restored.id !== workspaceId || restored.provider !== provider) {
        throw new Error("Serialized workspace handle lost its provider identity");
      }
      if (!restored.runtime.password) throw new Error("Serialized runtime password is missing");
      return restored;
    });

    workspace = await step(result.steps, "verify running workspace", () =>
      waitForWorkspaceStatus(client, workspace!, "running"),
    );
    if (workspace.status !== "running") {
      throw new Error(`Expected running workspace, received ${workspace.status}`);
    }

    if (client.provider.capabilities.supportsKeepAlive) {
      await step(result.steps, "exercise keep-alive", () =>
        client.workspaces.keepAlive(workspace!, settings.timeoutMs),
      );
    } else {
      console.log("  note: provider does not support keep-alive; check skipped");
    }

    activeRun = await step(result.steps, "create agent run", () =>
      client.runs.create({
        workspace: workspace!,
        title: `Direct provider smoke test: ${provider}`,
        prompt:
          "Read .gitterm-direct-smoke from the workspace root and respond with exactly its contents and no other text.",
        model: settings.model,
      }),
    );
    activeRun = await step(result.steps, "wait for agent run", () =>
      client.runs.wait(activeRun!, workspace!, { timeoutMs: settings.runTimeoutMs }),
    );
    if (activeRun.status !== "completed") {
      throw new Error(`Agent run finished with ${activeRun.status}: ${activeRun.error ?? ""}`);
    }

    const messages = await step(result.steps, "read agent messages", () =>
      client.runs.messages(activeRun!, workspace!),
    );
    if (
      !activeRun.finalText?.includes(marker) ||
      !messages.some((message) => message.role === "assistant" && message.text.includes(marker))
    ) {
      throw new Error(
        `Agent did not return the setup marker for ${settings.model}: ${JSON.stringify({
          status: activeRun.status,
          error: activeRun.error,
          finalText: activeRun.finalText,
          messages,
        })}`,
      );
    }

    if (client.provider.capabilities.supportsPause) {
      workspace = await step(result.steps, "pause workspace", () =>
        client.workspaces.pause(workspace!),
      );
      workspace = await step(result.steps, "verify paused workspace", () =>
        waitForWorkspaceStatus(client, workspace!, "paused"),
      );
      if (workspace.status !== "paused") {
        throw new Error(`Expected paused workspace, received ${workspace.status}`);
      }

      workspace = await step(result.steps, "resume workspace", () =>
        client.workspaces.resume(workspace!),
      );
      workspace = await step(result.steps, "verify resumed workspace", () =>
        waitForWorkspaceStatus(client, workspace!, "running"),
      );
      if (workspace.status !== "running") {
        throw new Error(`Expected running workspace after resume, received ${workspace.status}`);
      }
    } else {
      console.log("  note: provider does not support pause/resume; checks skipped");
    }

    workspace = await step(result.steps, "terminate workspace", () =>
      client.workspaces.terminate(workspace!),
    );
    terminated = true;
    result.cleanup = "terminated";

    workspace = await step(result.steps, "verify termination", () =>
      waitForWorkspaceStatus(client, workspace!, "terminated"),
    );
    if (workspace.status !== "terminated") {
      throw new Error(`Expected terminated workspace, received ${workspace.status}`);
    }
  } catch (error) {
    result.error = errorMessage(error);
  } finally {
    if (activeRun && workspace && ["running", "retrying"].includes(activeRun.status)) {
      await client.runs.cancel(activeRun, workspace).catch(() => false);
    }
    if (workspace && !terminated) {
      try {
        await step(result.steps, "cleanup workspace", () =>
          client.workspaces.terminate(workspace!),
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
  const providers = selectedProviders();
  const settings = smokeSettings();
  const configs = new Map(
    providers.map((provider) => [provider, providerConfig(provider, settings.timeoutMs)]),
  );
  const results: ProviderResult[] = [];

  console.log(`Running direct provider smoke tests sequentially: ${providers.join(", ")}`);
  for (const provider of providers) {
    results.push(await runProvider(provider, configs.get(provider)!, settings));
  }

  console.log("\nDirect provider smoke summary");
  for (const result of results) {
    const durationMs = result.steps.reduce((total, current) => total + current.durationMs, 0);
    console.log(
      `${result.error ? "FAIL" : "PASS"} ${result.provider} (${(durationMs / 1000).toFixed(1)}s, cleanup: ${result.cleanup}, workspace: ${result.workspaceId})`,
    );
    if (result.error) console.error(result.error);
  }

  if (results.some((result) => result.error)) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

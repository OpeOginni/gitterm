#!/usr/bin/env bun
/**
 * Managed OpenCode runtime smoke matrix (creates billable cloud workspaces).
 *
 *   bun run scripts/opencode-runtime-smoke.ts                         # all providers × v1/v2
 *   bun run scripts/opencode-runtime-smoke.ts --provider e2b --api v1
 *   bun run scripts/opencode-runtime-smoke.ts --provider e2b,daytona --api both
 *   bun run scripts/opencode-runtime-smoke.ts --all --api v2 --dry-run
 *
 * Loads scripts/.env, like provider-smoke.ts. Requires GITTERM_SERVER_URL,
 * GITTERM_API_TOKEN, and GITTERM_E2E_REPO. Provider credentials live on the
 * managed server, not here. Unavailable providers fail rather than silently skip.
 * Uses opencode/big-pickle; override with --model or GITTERM_E2E_MODEL.
 * GITTERM_MODEL_API_KEY optionally supplies an inline model credential.
 * V2 installs @opencode-ai/cli@beta in beforeAgent; V1 uses the image's binary.
 * Every matrix entry gets its own workspace, terminated even on test failure.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import {
  createGittermClient,
  type AgentRun,
  type AgentRunReply,
  type GittermClient,
  type OpencodeApi,
  type ProviderKey,
  type WorkspaceCreateInput,
} from "../packages/sdk/src/index.ts";

export const PROVIDERS = [
  "railway",
  "aws",
  "e2b",
  "daytona",
  "cloudflare",
  "vercel",
  "ascii",
  "exedev",
] as const satisfies readonly ProviderKey[];

export function smokeOptions(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      provider: { type: "string" },
      all: { type: "boolean" },
      api: { type: "string" },
      model: { type: "string" },
      verbose: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const selection = values.all ? "all" : (values.provider ?? env.GITTERM_E2E_PROVIDERS ?? "all");
  const providers =
    selection === "all"
      ? [...PROVIDERS]
      : [...new Set(selection.split(",").map((value) => value.trim()))];
  if (
    !providers.length ||
    providers.some((provider) => !PROVIDERS.includes(provider as ProviderKey))
  ) {
    throw new Error(`Unknown providers: ${selection}. Choose ${PROVIDERS.join(", ")} or all.`);
  }
  const api = values.api ?? "both";
  const apis: OpencodeApi[] =
    api === "both" || api === "all"
      ? ["v1", "v2"]
      : api === "v1" || api === "1"
        ? ["v1"]
        : api === "v2" || api === "2"
          ? ["v2"]
          : [];
  if (!apis.length) throw new Error("--api must be v1, v2, or both");
  const model = values.model ?? env.GITTERM_E2E_MODEL ?? "opencode/big-pickle";
  if (!/^[^/]+\/.+$/.test(model)) throw new Error("--model must use provider/model format");
  return {
    providers: providers as ProviderKey[],
    apis,
    model,
    verbose: values.verbose ?? false,
    dryRun: values["dry-run"] ?? false,
    help: values.help ?? false,
  };
}

/** Only runs inside a newly created, disposable managed workspace. */
export function beforeAgent(api: OpencodeApi): string {
  if (api === "v1")
    return [
      "set -eu",
      'version="$(opencode --version)"',
      'case "$version" in 1.*) ;; *) echo "Expected OpenCode 1, got $version" >&2; exit 1 ;; esac',
      'printf "OpenCode v1: %s\\n" "$version"',
    ].join("\n");

  return [
    "set -eu",
    'prefix="$HOME/.gitterm-runtime-smoke-v2"',
    'mkdir -p "$prefix"',
    'npm install --prefix "$prefix" @opencode-ai/cli@beta --no-audit --fund=false',
    'binary="$prefix/node_modules/.bin/opencode2"',
    'test -x "$binary"',
    'version="$("$binary" --version)"',
    // Provider serve commands (including container CMDs) still use opencode.
    // Replace the launcher, NOT its symlink target, and retain the original.
    'launcher="$(command -v opencode)"',
    'case "$launcher" in /*) ;; *) echo "Expected an absolute opencode launcher path" >&2; exit 1 ;; esac',
    "install_launcher() {",
    '  if [ ! -e "${launcher}.gitterm-smoke-v1" ] && [ ! -L "${launcher}.gitterm-smoke-v1" ]; then',
    '    "$@" mv "$launcher" "${launcher}.gitterm-smoke-v1"',
    "  fi",
    '  "$@" install -m 755 "$prefix/launcher" "$launcher"',
    "}",
    `printf '#!/bin/sh\nexec "%s" "$@"\n' "$binary" > "$prefix/launcher"`,
    'if [ -w "$(dirname "$launcher")" ]; then install_launcher; else install_launcher sudo -n; fi',
    'test "$(opencode --version)" = "$version"',
    'printf "OpenCode v2 (@opencode-ai/cli@beta): %s\\n" "$version"',
  ].join("\n");
}

type Options = ReturnType<typeof smokeOptions>;
type Settings = {
  repo: string;
  branch?: string;
  repositoryCredentials?: WorkspaceCreateInput["repositoryCredentials"];
  models: WorkspaceCreateInput["models"];
  setupTimeoutMs: number;
  runTimeoutMs: number;
};
type Result = {
  provider: ProviderKey;
  api: OpencodeApi;
  workspaceId?: string;
  durationMs: number;
  cleanup: "not-needed" | "terminated" | "failed";
  error?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function timeoutEnv(name: string, fallback: number, max = Infinity): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1_000 || value > max) {
    throw new Error(`${name} must be an integer between 1000 and ${max} ms`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function workspaceInput(
  provider: ProviderKey,
  api: OpencodeApi,
  options: Options,
  settings: Settings,
  id: string,
): WorkspaceCreateInput {
  return {
    idempotencyKey: id,
    name: id,
    repo: settings.repo,
    branch: settings.branch,
    repositoryCredentials: settings.repositoryCredentials,
    agent: "opencode",
    provider: { type: provider },
    models: settings.models,
    metadata: { smoke: "opencode-runtime", api },
    // Cost guardrail if the runner is interrupted before its finally block.
    autoTerminateAfterMs: Math.max(
      60_000,
      settings.setupTimeoutMs + 2 * settings.runTimeoutMs + 300_000,
    ),
    opencode: {
      api,
      // V2 supports this legacy permission configuration too.
      config: { model: options.model, permission: { bash: "ask" } },
    },
    setup: {
      beforeAgent: [beforeAgent(api)],
      // Makes setup completion observable, including the selected binary version.
      afterAgent: [`set -eu\nprintf 'smoke-api=${api} version='\nopencode --version`],
    },
  };
}

async function scenario(
  client: GittermClient,
  workspaceId: string,
  api: OpencodeApi,
  name: "permission" | "question",
  options: Options,
  settings: Settings,
) {
  console.log(`  scenario: ${name}`);
  const marker = `smoke-ok-${crypto.randomUUID()}`;
  let expected = name === "permission" ? marker : "";
  let run: AgentRun | undefined;
  let requestId: string | undefined;
  let resolved = false;
  try {
    run = await client.runs.create({
      workspace: workspaceId,
      title: `Runtime smoke ${api}: ${name}`,
      model: options.model,
      prompt:
        name === "permission"
          ? `Run the shell command \`echo ${marker}\` using the ${api === "v1" ? "bash" : "shell"} tool and report its output. Do not ask me anything else.`
          : "Use the question tool to ask one question: whether to proceed with approach A or approach B. Wait for my answer, then reply with exactly: chosen=<selected option label>.",
      waitForSetup: true,
      setupTimeoutMs: settings.setupTimeoutMs,
    });
    for await (const event of client.runs.events(run, {
      signal: AbortSignal.timeout(settings.runTimeoutMs),
    })) {
      run = event.run;
      if (options.verbose) console.log(`    ${event.type} (${run.status})`);
      if (event.type === "input.required") {
        if (requestId) throw new Error(`${name}: unexpected additional input request`);
        const request = event.request;
        if (request.kind !== name) throw new Error(`Expected ${name}, got ${request.kind}`);
        const pending = await client.runs.get(run);
        if (
          pending.status !== "awaiting_input" ||
          !pending.pendingInputs.some((input) => input.id === request.id)
        ) {
          throw new Error(`${name}: snapshot did not expose the pending input`);
        }
        requestId = request.id;
        let reply: AgentRunReply;
        if (request.kind === "permission") {
          console.log(`    permission: ${request.title}`);
          reply = { type: "permission", response: "once" };
        } else {
          const question = request.questions[0];
          const option = question?.options[0];
          if (request.questions.length !== 1 || !question || !option) {
            throw new Error("Expected one question with at least one option");
          }
          console.log(`    question: ${question.header} → ${option.label}`);
          expected = `chosen=${option.label}`;
          reply = { type: "question", answers: { [question.key]: [option.label] } };
        }
        await client.runs.respond(run, { requestId, reply });
      }
      if (event.type === "input.resolved" && event.requestId === requestId) resolved = true;
      if (event.type === "run.failed" || event.type === "run.cancelled") {
        throw new Error(`${name}: ${run.status}: ${run.error ?? "no error details"}`);
      }
      if (event.type === "run.completed") break;
    }
    if (run.status !== "completed" || !requestId || !resolved || run.pendingInputs.length) {
      throw new Error(
        `${name}: expected input required → resolved → completed, got ${run.status} ` +
          `(run: ${run.id}, input observed: ${!!requestId}, resolved: ${resolved}, pending: ${run.pendingInputs.length})` +
          (run.status === "completed" && !requestId
            ? "; no input request was observed—check that the agent loaded the workspace permission config and actually called the requested tool"
            : ""),
      );
    }
    const final = await client.runs.get(run);
    if (final.status !== "completed" || !final.finalText?.includes(expected)) {
      throw new Error(`${name}: unexpected final snapshot: ${JSON.stringify(final)}`);
    }
    const messages = await client.runs.messages(run);
    const tools = messages
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "tool");
    const tool = name === "question" ? "question" : api === "v1" ? "bash" : "shell";
    if (!tools.some((part) => part.tool === tool && part.status === "completed")) {
      throw new Error(`${name}: no completed ${tool} tool in messages`);
    }
    console.log(`    completed: ${JSON.stringify(final.finalText?.slice(0, 100))}`);
  } finally {
    if (run && !["completed", "failed", "cancelled"].includes(run.status)) {
      await client.runs
        .cancel(run)
        .catch((error) => console.error(`    cancel failed: ${errorMessage(error)}`));
    }
  }
}

export async function runPair(
  client: GittermClient,
  provider: ProviderKey,
  api: OpencodeApi,
  options: Options,
  settings: Settings,
  available: Set<ProviderKey>,
): Promise<Result> {
  const started = performance.now();
  const result: Result = { provider, api, durationMs: 0, cleanup: "not-needed" };
  const id = `runtime-smoke-${provider}-${api}-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`\n[${provider}/${api}]`);
  try {
    if (!available.has(provider))
      throw new Error(`${provider} is unavailable or does not support managed OpenCode servers`);
    const created = await client.workspaces.create(
      workspaceInput(provider, api, options, settings, id),
    );
    result.workspaceId = created.workspace.id;
    console.log(`  workspace: ${result.workspaceId}`);
    const running = await client.workspaces.ensureRunning(result.workspaceId, {
      timeoutMs: Math.min(settings.setupTimeoutMs, 240_000),
    });
    if (
      running.workspace.status !== "running" ||
      running.runtime.providerKey !== provider ||
      running.workspace.opencodeApi !== api
    ) {
      throw new Error(`Workspace did not select running ${provider}/${api}`);
    }
    const setup = await client.workspaces.waitForSetup(result.workspaceId, {
      timeoutMs: settings.setupTimeoutMs,
    });
    if (setup.status !== "succeeded" || !setup.log?.includes(`smoke-api=${api} version=`)) {
      throw new Error(`Setup did not verify ${api}: ${setup.status}\n${setup.log ?? ""}`);
    }
    console.log(
      `  ${setup.log
        .trim()
        .split("\n")
        .find((line) => line.includes("smoke-api="))}`,
    );
    await scenario(client, result.workspaceId, api, "permission", options, settings);
    await scenario(client, result.workspaceId, api, "question", options, settings);
  } catch (error) {
    result.error = errorMessage(error);
    console.error(`  FAIL [${provider}/${api}]: ${result.error}`);
  } finally {
    if (result.workspaceId) {
      try {
        await client.workspaces.terminate(result.workspaceId);
        result.cleanup = "terminated";
      } catch (error) {
        result.cleanup = "failed";
        result.error = `${result.error ? `${result.error}\n` : ""}Cleanup failed: ${errorMessage(error)}`;
      }
    }
    result.durationMs = Math.round(performance.now() - started);
  }
  return result;
}

async function main() {
  dotenv.config({ path: join(import.meta.dir, ".env"), quiet: true });
  const options = smokeOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Managed OpenCode runtime smoke test (creates billable workspaces).
Usage: bun run scripts/opencode-runtime-smoke.ts [options]
  --provider <name,...|all>  Default: all managed providers
  --all                      Select all managed providers
  --api <v1|v2|both>          Default: both (also accepts 1, 2)
  --model <provider/model>   Default: GITTERM_E2E_MODEL or opencode/big-pickle
  --dry-run                  Print the matrix without provisioning or credentials
  --verbose                  Log managed run events
Requires GITTERM_SERVER_URL, GITTERM_API_TOKEN, GITTERM_E2E_REPO in scripts/.env.
Optional: GITTERM_MODEL_API_KEY, GITTERM_E2E_BRANCH, GITTERM_E2E_REPO_TOKEN,
GITTERM_E2E_REPO_USERNAME, GITTERM_E2E_TIMEOUT_MS, GITTERM_E2E_RUN_TIMEOUT_MS.`);
    return;
  }
  const matrix = options.providers.flatMap((provider) =>
    options.apis.map((api) => ({ provider, api })),
  );
  console.log(
    `Managed runtime matrix (${matrix.length} workspaces, sequential): ${matrix.map(({ provider, api }) => `${provider}/${api}`).join(", ")}`,
  );
  if (options.dryRun) return;
  const client = createGittermClient({
    serverUrl: requiredEnv("GITTERM_SERVER_URL"),
    token: requiredEnv("GITTERM_API_TOKEN"),
  });
  const modelProvider = options.model.slice(0, options.model.indexOf("/"));
  const modelApiKey =
    process.env.GITTERM_MODEL_API_KEY?.trim() ||
    (options.model === "opencode/big-pickle" ? "public" : undefined);
  const repoToken = process.env.GITTERM_E2E_REPO_TOKEN?.trim();
  const username = process.env.GITTERM_E2E_REPO_USERNAME?.trim();
  if (username && !repoToken)
    throw new Error("GITTERM_E2E_REPO_USERNAME requires GITTERM_E2E_REPO_TOKEN");
  const settings: Settings = {
    repo: requiredEnv("GITTERM_E2E_REPO"),
    branch: process.env.GITTERM_E2E_BRANCH?.trim() || undefined,
    repositoryCredentials: repoToken ? { token: repoToken, username } : undefined,
    models: modelApiKey
      ? { providers: { [modelProvider]: { source: "apiKey", apiKey: modelApiKey } } }
      : undefined,
    setupTimeoutMs: timeoutEnv("GITTERM_E2E_TIMEOUT_MS", 360_000, 600_000),
    runTimeoutMs: timeoutEnv("GITTERM_E2E_RUN_TIMEOUT_MS", 180_000, 60 * 60_000),
  };
  await client.auth.status();
  const catalog = await client.catalog.workspaceOptions();
  const available = new Set(
    catalog.providers
      .filter((provider) => provider.agentKeys.includes("opencode"))
      .map((provider) => provider.type),
  );
  const results: Result[] = [];
  for (const { provider, api } of matrix)
    results.push(await runPair(client, provider, api, options, settings, available));
  console.log("\nManaged OpenCode runtime smoke summary");
  for (const result of results) {
    console.log(
      `${result.error ? "FAIL" : "PASS"} ${result.provider}/${result.api} (${(result.durationMs / 1000).toFixed(1)}s, cleanup: ${result.cleanup}, workspace: ${result.workspaceId ?? "not created"})`,
    );
    if (result.error) console.error(result.error);
  }
  if (results.some((result) => result.error)) process.exitCode = 1;
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}

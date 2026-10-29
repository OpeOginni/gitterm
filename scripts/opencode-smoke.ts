/** Real OpenCode compatibility check with isolated homes and a loopback model fixture. */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createOpencodeClient } from "../packages/agent-runtime/src/http";
import { getRuntime } from "../packages/agent-runtime/src";
import { createOpencodeConnection } from "../packages/agent-runtime/src/pairing";
import { OPENCODE_SERVICE_REGISTRAR_SCRIPT } from "../packages/agent-runtime/src/opencode-service";
import { opencodeProvisioner } from "../packages/api/src/service/agents/opencode";
import { buildDirectProvisioningPlan } from "../packages/sdk/src/direct/provisioning";
import { createDirectGittermClient } from "../packages/sdk/src/direct/client";
import type { DirectProviderAdapter } from "../packages/sdk/src/direct/types";
import runtimePackage from "../packages/agent-runtime/package.json";
import { validateOpenCodeConfig } from "../packages/schema/src/agent-config";

const binary = process.env.OPENCODE_SMOKE_BINARY;
if (!binary) throw new Error("Set OPENCODE_SMOKE_BINARY to an OpenCode 2 executable");
if (process.platform === "win32")
  throw new Error("This process-group smoke requires macOS or Linux");
const executable = resolve(binary);
const root = await realpath(
  await mkdtemp(join(process.env.OPENCODE_SMOKE_ROOT ?? tmpdir(), "gitterm-opencode-smoke-")),
);
const servers: ChildProcess[] = [];
const password = "isolated-smoke-password";
const signal = AbortSignal.timeout(120_000);
const version = runtimePackage.dependencies["@opencode/client"];
let modelCalls = 0;
let variantCalls = 0;
let managedRefreshes = 0;
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/workspaceOps.modelCredential") {
      check(
        request.headers.get("authorization") === "Bearer fixture-identity",
        "Managed refresh lost workspace authentication",
      );
      check(
        ((await request.json()) as { credentialId: string }).credentialId === "fixture-managed",
        "Managed refresh used the wrong account",
      );
      managedRefreshes++;
      return Response.json({
        result: { data: { access: "fixture-refreshed", expires: Date.now() + 3_600_000 } },
      });
    }
    const input = (await request.json()) as {
      messages: Array<{ role: string; content?: unknown }>;
      smoke_variant?: boolean;
    };
    modelCalls++;
    if (input.smoke_variant) variantCalls++;
    const last = input.messages.findLast((message) => message.role === "user");
    if (
      JSON.stringify(last?.content).includes("tool-smoke") &&
      !input.messages.some((message) => message.role === "tool")
    ) {
      return new Response(
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_fixture",
              type: "function",
              function: {
                name: "shell",
                arguments: JSON.stringify({ command: "printf tool-smoke" }),
              },
            },
          ],
        }) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n",
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    const hold = JSON.stringify(last?.content).includes("hold-smoke");
    const firstChunk = chunk({
      role: "assistant",
      content: hold ? "Waiting" : "isolated-smoke-ok",
    });
    if (hold)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(firstChunk));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    return new Response(firstChunk + chunk({}, "stop") + "data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  },
});

function chunk(delta: unknown, finish_reason: string | null = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function until<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    signal.throwIfAborted();
    await Bun.sleep(100);
  }
  throw new Error(message);
}

const config = {
  model: "smoke/fixture",
  theme: "tokyonight",
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "smoke", effect: "allow" },
    { action: "provider.use", resource: "anthropic", effect: "allow" },
    { action: "provider.use", resource: "openai", effect: "allow" },
  ],
  providers: {
    smoke: {
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
      models: {
        fixture: {
          limit: { context: 32_000, output: 1_000 },
          capabilities: { tools: true },
          variants: [{ id: "fixture-variant", body: { smoke_variant: true } }],
        },
      },
    },
    openai: { settings: { baseURL: `http://127.0.0.1:${model.port}/v1` } },
  },
  permissions: [{ action: "shell", resource: "*", effect: "ask" }],
};

async function start(
  name: string,
  files: Array<{ path: string; contentBase64: string; mode?: number }>,
  environment: Record<string, string>,
) {
  const home = join(root, `${name}-home`);
  const directory = join(root, `${name}-repo`);
  await mkdir(directory, { recursive: true });
  const git = Bun.spawn(["git", "init", "-q", directory], { stdout: "ignore", stderr: "pipe" });
  check((await git.exited) === 0, "Fixture git init failed");
  for (const file of files) {
    check(file.path.startsWith("~/"), "Unexpected provisioned path");
    const target = join(home, file.path.slice(2));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.contentBase64, "base64"), { mode: file.mode });
  }
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const env = {
    PATH: `${dirname(executable)}:${process.env.PATH}`,
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: "en_US.UTF-8",
    SHELL: "/bin/sh",
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    ...environment,
  };
  const server = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: directory,
    env,
    detached: true,
    stdio: "ignore",
  });
  servers.push(server);
  const target = { url: `http://127.0.0.1:${port}`, password, directory };
  const client = createOpencodeClient(target);
  await until(
    async () => {
      check(server.exitCode === null, `${name} server exited before readiness`);
      return client.server.info({ signal: AbortSignal.timeout(1_000) }).catch(() => null);
    },
    (value) => !!value,
    `${name} server readiness timed out`,
  );
  const session = await client.session.create(
    { location: { directory }, title: "Isolated smoke" },
    { signal },
  );
  await client.agent.list({ location: { directory } }, { signal });
  check(
    (await client.server.info({ signal })).version === version,
    `Smoke binary must match the pinned OpenCode ${version} client`,
  );
  const cli = JSON.parse(await readFile(join(home, ".config/opencode/cli.json"), "utf8"));
  check(cli.theme.name === "tokyonight", "Provisioned CLI theme was lost");
  return { home, env, target, client, session };
}

try {
  check(
    validateOpenCodeConfig(config).success,
    "Saved config validation rejected the native fixture",
  );
  const fixture = join(root, "fixture-plugin");
  await mkdir(fixture);
  await writeFile(
    join(fixture, "index.js"),
    `export default {
    id: "gitterm-smoke",
    async setup(ctx) {
      if (ctx.options.marker !== "native-options") throw new Error("Native plugin options were lost");
      await ctx.command.transform((editor) => editor.add({
        name: "smoke-credentials",
        async execute() {
          const connection = await ctx.integration.connection.active("openai");
          const credential = await ctx.integration.connection.resolve(connection);
          if (credential.access !== "fixture-refreshed") throw new Error("Managed credential did not refresh");
        },
      }));
    },
  };`,
  );
  const hosted = opencodeProvisioner.provision({
    userId: "fixture",
    userDisplayName: "Smoke",
    agentTypeName: "OpenCode",
    serverOnly: true,
    workspaceHostname: "localhost",
    serverPassword: password,
    agentConfigs: {
      opencode: {
        ...config,
        plugins: [{ package: fixture, options: { marker: "native-options" } }],
      },
    },
    credentials: [
      {
        credentialId: "fixture",
        providerName: "anthropic",
        logicalProviderKey: "anthropic",
        label: "isolated",
        isDefault: true,
        credential: { type: "api_key", apiKey: "fixture-not-a-real-key" },
      },
      {
        credentialId: "fixture-managed",
        providerName: "openai-oauth",
        logicalProviderKey: "openai",
        label: "managed",
        isDefault: true,
        credential: { type: "oauth", refresh: "unused", access: "expired-fixture", expires: 1 },
      },
    ],
  });
  const local = await start("hosted", hosted.files, {
    ...hosted.env,
    WORKSPACE_API_URL: `http://127.0.0.1:${model.port}`,
    WORKSPACE_AGENT_AUTH_TOKEN: "fixture-identity",
  });
  await until(
    () => local.client.credential.list({ signal }),
    (entries) => entries.some((entry) => entry.label === "isolated" && entry.active),
    "Hosted credential importer did not activate the fixture account",
  );
  await local.client.session.command(
    { sessionID: local.session.id, name: "smoke-credentials", text: "" },
    { signal },
  );
  await local.client.session.command(
    { sessionID: local.session.id, name: "smoke-credentials", text: "" },
    { signal },
  );
  check(managedRefreshes === 1, "Managed OAuth refresh was not persisted and reused");

  // Execute the emitted registrar, then make the actual CLI discover this exact server.
  const registrar = join(root, "register-service.sh");
  await writeFile(registrar, OPENCODE_SERVICE_REGISTRAR_SCRIPT);
  const registered = Bun.spawn(["sh", registrar, String(new URL(local.target.url).port), "2"], {
    env: local.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  check((await registered.exited) === 0, "Service registrar failed");
  const api = Bun.spawn([executable, "api", "get", "/api/info"], {
    env: local.env,
    cwd: local.target.directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const apiText = await new Response(api.stdout).text();
  check(
    (await api.exited) === 0,
    `CLI API discovery failed: ${await new Response(api.stderr).text()}`,
  );
  check(
    JSON.parse(apiText).pid === (await local.client.server.info({ signal })).pid,
    "CLI started a second server instead of reusing the registered workspace server",
  );

  const link = await createOpencodeConnection(local.target, "link");
  check(link.kind === "link", "Pairing did not return a link");
  const browser = await fetch(link.link, {
    redirect: "manual",
    headers: { Accept: "text/html" },
    signal,
  });
  check(
    browser.status === 302 && browser.headers.has("set-cookie"),
    "Browser pairing did not create a session cookie",
  );
  const reused = await fetch(link.link, { redirect: "manual", signal });
  check(reused.status >= 400, "Pairing code was reusable");
  const tui = await createOpencodeConnection(local.target, "tui");
  check(tui.kind === "tui" && tui.token !== password, "TUI pairing leaked the server password");
  check(
    (await createOpencodeClient({ ...local.target, password: tui.token }).server.info({ signal }))
      .pid === (await local.client.server.info({ signal })).pid,
    "Paired TUI token could not authenticate",
  );

  const runtime = getRuntime({ ...local.target, signal });
  const form = await local.client.session.form.create(
    {
      sessionID: local.session.id,
      title: "Fixture choice",
      fields: [
        {
          key: "choice",
          type: "string",
          title: "Choose",
          required: true,
          options: [{ value: "value", label: "Readable label" }],
        },
      ],
    },
    { signal },
  );
  const question = (await runtime.snapshot(local.session.id, "msg_unused")).pendingInputs.find(
    (item) => item.id === form.id,
  );
  check(question?.kind === "question", "Real form did not reach the runtime adapter");
  await runtime.replyQuestion(local.session.id, question, [["Readable label"]]);
  const answered = await local.client.session.form.get(
    { sessionID: local.session.id, formID: form.id },
    { signal },
  );
  check(
    answered.state.status === "answered" && answered.state.answer.choice === "value",
    "Question reply lost the option value",
  );
  const cancelled = await local.client.session.form.create(
    { sessionID: local.session.id, title: "Cancel", fields: [{ key: "answer", type: "string" }] },
    { signal },
  );
  await runtime.rejectQuestion(local.session.id, cancelled.id);
  check(
    (
      await local.client.session.form.get(
        { sessionID: local.session.id, formID: cancelled.id },
        { signal },
      )
    ).state.status === "cancelled",
    "Question rejection did not cancel the form",
  );

  const permission = await local.client.permission.create(
    { sessionID: local.session.id, action: "shell", resources: ["printf fixture"] },
    { signal },
  );
  check(permission.effect === "ask", "Permission rule did not prompt");
  const pending = await until(
    () => runtime.snapshot(local.session.id, "msg_unused"),
    (snapshot) => snapshot.pendingInputs.some((item) => item.kind === "permission"),
    "Permission request did not reach the adapter",
  );
  await runtime.replyPermission(
    local.session.id,
    pending.pendingInputs.find((item) => item.kind === "permission")!.id,
    "once",
  );
  check(
    !(await local.client.permission.list({ sessionID: local.session.id }, { signal })).some(
      (item) => item.id === permission.id,
    ),
    "Permission reply did not resolve the real request",
  );

  const plan = buildDirectProvisioningPlan({
    id: "fixture",
    lifecycle: "ephemeral",
    password,
    opencode: { config },
    models: {
      providers: { anthropic: { source: "apiKey", apiKey: "direct-fixture-key", label: "direct" } },
    },
  });
  const direct = await start("direct", plan.agent.files, plan.agent.environmentVariables);
  const provider: DirectProviderAdapter = {
    name: "fixture",
    capabilities: {
      persistence: "unsupported",
      recommendedLifecycle: "ephemeral",
      supportsPause: false,
      ephemeralPause: "unsupported",
      supportsKeepAlive: false,
    },
    create: async () => ({ externalId: "fixture", runtime: direct.target }),
    status: async () => "running",
    terminate: async () => {},
  };
  const sdk = createDirectGittermClient({ provider });
  const workspace = await sdk.workspaces.create({
    setup: { afterAgent: ["printf setup-ok > setup-proof.txt"] },
  });
  check(
    (await sdk.workspaces.waitForSetup(workspace, { timeoutMs: 10_000, pollIntervalMs: 100 }))
      .status === "succeeded",
    "Direct post-start setup failed",
  );
  check(
    (await readFile(join(direct.target.directory, "setup-proof.txt"), "utf8")) === "setup-ok",
    "Post-start PTY did not write the expected file",
  );
  check(
    (await sdk.auth.get(workspace, "anthropic")).connections.some(
      (entry) => entry.type === "credential" && entry.label === "direct",
    ),
    "Direct credentials were not imported",
  );
  const run = await sdk.runs.create({
    workspace,
    prompt: "reply smoke",
    model: "smoke/fixture#fixture-variant",
  });
  const completed = await sdk.runs.wait(run, { signal });
  check(
    completed.status === "completed" && completed.finalText === "isolated-smoke-ok",
    `Run did not complete: ${JSON.stringify(completed)}`,
  );
  check(
    (await sdk.runs.messages(completed)).some(
      (message) => message.role === "assistant" && message.text === "isolated-smoke-ok",
    ),
    "SDK lost assistant history",
  );
  const continued = await sdk.runs.create({
    workspace,
    prompt: "continue smoke",
    model: "smoke/fixture",
    context: { type: "continue", run: completed },
  });
  check(continued.sessionId === completed.sessionId, "Continuation created a different session");
  check(
    (await sdk.runs.wait(continued, { signal })).status === "completed",
    "Continued run did not finish",
  );
  const toolRun = await sdk.runs.create({
    workspace,
    prompt: "tool-smoke",
    model: "smoke/fixture",
  });
  const awaiting = await until(
    () => sdk.runs.get(toolRun),
    (current) => current.status === "awaiting_input",
    "The shell tool did not request permission",
  );
  const toolPermission = awaiting.pendingInputs.find((input) => input.kind === "permission");
  check(toolPermission, "The SDK lost the shell permission request");
  await sdk.runs.respond(toolRun, {
    requestId: toolPermission.id,
    reply: { type: "permission", response: "once" },
  });
  check(
    (await sdk.runs.wait(toolRun, { signal })).status === "completed",
    "Tool run did not finish",
  );
  check(
    (await sdk.runs.messages(toolRun)).some((message) =>
      message.parts.some(
        (part) =>
          part.type === "tool" &&
          part.status === "completed" &&
          part.output?.includes("tool-smoke"),
      ),
    ),
    "The SDK lost the actual shell tool output",
  );
  const held = await sdk.runs.create({ workspace, prompt: "hold-smoke", model: "smoke/fixture" });
  await until(
    () => sdk.runs.messages(held),
    (messages) => messages.some((message) => message.role === "assistant"),
    "Held run never started",
  );
  check((await sdk.runs.cancel(held)).cancelled, "Run cancellation failed");
  check(
    (await sdk.runs.wait(held, { signal })).status === "cancelled",
    "Cancelled run did not reach a terminal state",
  );
  await getRuntime({ ...direct.target, signal }).deleteSession(held.sessionId);
  check(
    !(await getRuntime({ ...direct.target, signal }).snapshot(held.sessionId, held.messageId))
      .sessionExists,
    "Session removal did not reach the server",
  );
  check(modelCalls >= 5, "The real model dispatch path was not exercised");
  check(variantCalls > 0, "The selected model variant was not applied to the model request");
  console.log(
    `OpenCode ${version} smoke passed: config validation, hosted/direct provisioning, plugin options, credential import/managed OAuth refresh, service discovery, browser/TUI pairing, forms, permissions, PTY setup, SDK execution/SSE, model variants, shell tool output, continuation, cancellation, deletion. Model responses were loopback fixtures; no paid provider calls.`,
  );
} finally {
  for (const server of servers) {
    if (server.exitCode !== null || server.signalCode !== null) continue;
    const exited = once(server, "exit");
    process.kill(-server.pid!, "SIGKILL");
    await exited;
  }
  model.stop(true);
  await rm(root, { recursive: true, force: true });
}

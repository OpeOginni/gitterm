#!/usr/bin/env bun
/**
 * Drive the agent-run OpenCode adapters against a local `opencode serve`
 * without a GitTerm server or workspace. Verifies the permission and
 * `question` tool flows end to end on either API generation.
 *
 *   bun run scripts/opencode-runtime-smoke.ts            # v1: `opencode` on PATH
 *   bun run scripts/opencode-runtime-smoke.ts --api v2   # v2: `opencode2` on PATH
 *
 * Uses the free `opencode/big-pickle` model; override with --model provider/model.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRuntime, deriveRunState } from "../packages/api/src/service/agent-run/runtime";
import type { OpencodeRuntime, RuntimeSignal } from "../packages/api/src/service/agent-run/runtime";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]!.replace(/^--/, ""), process.argv[index + 1] ?? "true");
}
const api = (args.get("api") ?? "v1") as "v1" | "v2";
const model = args.get("model") ?? "opencode/big-pickle";
const binary = args.get("binary") ?? (api === "v2" ? "opencode2" : "opencode");
const port = Number(args.get("port") ?? (api === "v2" ? 4299 : 4298));
const password = "smoke-password";

const directory = mkdtempSync(join(tmpdir(), "gitterm-runtime-smoke-"));
writeFileSync(
  join(directory, "opencode.json"),
  JSON.stringify({ $schema: "https://opencode.ai/config.json", permission: { bash: "ask" } }),
);
Bun.spawnSync(["git", "init", "-q", "."], { cwd: directory });

const server = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: directory,
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
  stdout: "ignore",
  stderr: "pipe",
});
process.on("exit", () => server.kill());

const runtime = getRuntime({ url: `http://127.0.0.1:${port}`, directory, password, api });
await waitForServer(runtime);
console.log(`[${api}] ${binary} serving ${directory}`);

const signals: RuntimeSignal[] = [];
const abort = new AbortController();
const verbose = args.get("verbose") === "true";
const streaming = (async () => {
  for await (const signal of runtime.subscribe(abort.signal)) {
    if (verbose) console.log("  signal", JSON.stringify(signal).slice(0, 200));
    signals.push(signal);
  }
})().catch((error) => {
  if (!abort.signal.aborted) throw error;
});
await until(() => signals.some((signal) => signal.type === "connected"), 10_000, "connect");

try {
  await scenario("permission", runtime, {
    prompt:
      "Run the shell command `echo smoke-ok` using the bash tool and report its output. Do not ask me anything else.",
    async answer(sessionId, request) {
      if (request.kind !== "permission")
        throw new Error(`expected a permission, got ${request.kind}`);
      console.log(`  permission asked: ${request.title} (always: ${request.always.join(", ")})`);
      await runtime.replyPermission(sessionId, request.id, "once");
    },
    expectText: "smoke-ok",
  });
  await scenario("question", runtime, {
    prompt:
      "Use the question tool to ask me whether to proceed with approach A or approach B. Wait for my answer, then reply with exactly: chosen=<answer>.",
    async answer(sessionId, request) {
      if (request.kind !== "question") throw new Error(`expected a question, got ${request.kind}`);
      const question = request.questions[0]!;
      console.log(
        `  question asked: ${question.header} → ${question.options.map((option) => option.label).join(" | ")}`,
      );
      await runtime.replyQuestion(sessionId, request, [[question.options[0]!.label]]);
    },
    expectText: "chosen=",
  });
  console.log(`[${api}] OK`);
} finally {
  abort.abort();
  await streaming;
  server.kill();
}

async function scenario(
  name: string,
  runtime: OpencodeRuntime,
  input: {
    prompt: string;
    answer: (sessionId: string, request: RuntimeSignal & { type: "input.asked" }) => Promise<void>;
    expectText: string;
  },
) {
  console.log(`[${api}] scenario: ${name}`);
  const session = await runtime.createSession({ title: `smoke ${name}`, model });
  const messageId = `msg_smoke${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const submittedAt = new Date();
  const seen = signals.length;
  await runtime.prompt({ sessionId: session.id, messageId, prompt: input.prompt, model });

  const asked = await until(
    () =>
      signals
        .slice(seen)
        .find(
          (signal): signal is RuntimeSignal & { type: "input.asked" } =>
            signal.type === "input.asked" && signal.sessionId === session.id,
        ),
    90_000,
    `${name}: input.asked signal`,
  ).catch(async (error) => {
    const snapshot = await runtime.snapshot(session.id, messageId).catch(() => null);
    console.error(`  debug snapshot:`, JSON.stringify(snapshot)?.slice(0, 1200));
    console.error(
      `  signals seen: ${signals
        .slice(seen)
        .map((signal) => signal.type)
        .join(", ")}`,
    );
    throw error;
  });
  const pending = await runtime.snapshot(session.id, messageId);
  const derived = deriveRunState(pending, { submittedAt });
  if (derived.status !== "awaiting_input") {
    throw new Error(`${name}: expected awaiting_input from snapshot, got ${derived.status}`);
  }
  if (!pending.pendingInputs.some((request) => request.id === asked.request.id)) {
    throw new Error(`${name}: snapshot did not list the asked request ${asked.request.id}`);
  }
  await input.answer(session.id, asked.request);

  await until(
    () =>
      signals
        .slice(seen)
        .some(
          (signal) =>
            signal.type === "input.resolved" &&
            signal.sessionId === session.id &&
            signal.requestId === asked.request.id,
        ),
    10_000,
    `${name}: input.resolved signal`,
  );
  const final = await until(
    async () => {
      const snapshot = await runtime.snapshot(session.id, messageId);
      const state = deriveRunState(snapshot, { submittedAt });
      return state.status === "completed" ? snapshot : undefined;
    },
    90_000,
    `${name}: completed snapshot`,
  );
  if (!final.finalText?.includes(input.expectText)) {
    throw new Error(
      `${name}: final text ${JSON.stringify(final.finalText)} lacks ${input.expectText}`,
    );
  }
  const tools = final.messages.flatMap((message) =>
    (message.parts ?? []).filter((part) => part.type === "tool"),
  );
  console.log(
    `  completed; final text ${JSON.stringify(final.finalText?.slice(0, 60))}; tool parts: ${tools
      .map((part) => (part.type === "tool" ? `${part.tool}:${part.status}` : ""))
      .join(", ")}`,
  );
}

async function waitForServer(runtime: OpencodeRuntime) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await runtime.snapshot("ses_probe000000000000000000", "msg_probe");
      return;
    } catch (error) {
      if (server.exitCode !== null) {
        throw new Error(`${binary} exited: ${await new Response(server.stderr).text()}`, {
          cause: error,
        });
      }
      if (error instanceof Error && /Session not found|404/.test(error.message)) return;
    }
    await Bun.sleep(500);
  }
  throw new Error(`${binary} did not start on port ${port}`);
}

async function until<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

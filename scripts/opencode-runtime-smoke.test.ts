import { describe, expect, test } from "bun:test";
import type {
  AgentRun,
  AgentRunInputRequest,
  GittermClient,
  OpencodeApi,
} from "../packages/sdk/src/index.ts";
import {
  beforeAgent,
  PROVIDERS,
  runPair,
  smokeOptions,
  workspaceInput,
} from "./opencode-runtime-smoke";

const settings = {
  repo: "https://github.com/example/smoke",
  models: undefined,
  setupTimeoutMs: 360_000,
  runTimeoutMs: 180_000,
};
const options = smokeOptions([], {});

describe("managed runtime smoke options", () => {
  test("defaults to every managed provider on V2", () => {
    expect(options.providers).toEqual([...PROVIDERS]);
    expect(options.apis).toEqual(["v2"]);
  });

  test("supports individual versions, comma-separated providers, and boolean flags", () => {
    const selected = smokeOptions(
      ["--verbose", "--provider=e2b,daytona,e2b", "--api", "1", "--dry-run"],
      {},
    );
    expect(selected.providers).toEqual(["e2b", "daytona"]);
    expect(selected.apis).toEqual(["v1"]);
    expect(selected.verbose).toBe(true);
    expect(selected.dryRun).toBe(true);
    expect(smokeOptions(["--api", "2"], {}).apis).toEqual(["v2"]);
    expect(smokeOptions(["--api", "v2"], {}).apis).toEqual(["v2"]);
  });

  test("uses managed provider env selection and lets --all override it", () => {
    const env = { GITTERM_E2E_PROVIDERS: "railway" };
    expect(smokeOptions([], env).providers).toEqual(["railway"]);
    expect(smokeOptions(["--all"], env).providers).toEqual([...PROVIDERS]);
  });

  test("rejects invalid versions, providers, models, and obsolete local flags", () => {
    for (const args of [
      ["--api", "v3"],
      ["--provider", "local"],
      ["--provider", "e2b,"],
      ["--model", "invalid"],
      ["--binary", "opencode"],
    ]) {
      expect(() => smokeOptions(args, {})).toThrow();
    }
  });
});

test("each workspace selects the matching adapter and setup, with automatic expiry", () => {
  for (const api of ["v1", "v2"] as const) {
    const input = workspaceInput("e2b", api, options, settings, `smoke-${api}`);
    expect(input.provider).toEqual({ type: "e2b" });
    expect(input.opencode?.api).toBe(api);
    expect(input.setup?.beforeAgent).toEqual([beforeAgent(api)]);
    expect(input.setup?.afterAgent?.[0]).toContain(`smoke-api=${api}`);
    expect(input.autoTerminateAfterMs).toBeGreaterThan(
      settings.setupTimeoutMs + 2 * settings.runTimeoutMs,
    );
    expect(input.opencode?.config?.permission).toEqual({ bash: "ask" });
  }
  expect(beforeAgent("v1")).not.toContain("npm install");
  expect(beforeAgent("v2")).not.toContain("npm install");
});

function mockClient(api: OpencodeApi, setupFails = false, cleanupFails = false) {
  const calls: string[] = [];
  const client = {
    workspaces: {
      async create() {
        calls.push("create");
        return { workspace: { id: "workspace-test" } };
      },
      async ensureRunning() {
        return {
          workspace: { status: "running", opencodeApi: api },
          runtime: { providerKey: "e2b" },
        };
      },
      async waitForSetup() {
        return {
          status: setupFails ? "failed" : "succeeded",
          log: `smoke-api=${api} version=test`,
        };
      },
      async terminate() {
        calls.push("terminate");
        if (cleanupFails) throw new Error("cleanup error");
      },
    },
  } as unknown as GittermClient;
  return { client, calls };
}

test("failed setup still terminates its managed workspace", async () => {
  const { client, calls } = mockClient("v2", true);
  const result = await runPair(client, "e2b", "v2", options, settings, new Set(["e2b"]));
  expect(result.error).toContain("Setup did not verify v2");
  expect(result.cleanup).toBe("terminated");
  expect(calls).toEqual(["create", "terminate"]);
});

test("cleanup failures and unavailable providers cannot pass", async () => {
  const { client, calls } = mockClient("v2", true, true);
  const failed = await runPair(client, "e2b", "v2", options, settings, new Set(["e2b"]));
  expect(failed.cleanup).toBe("failed");
  expect(failed.error).toContain("Cleanup failed: cleanup error");
  calls.length = 0;
  const unavailable = await runPair(client, "aws", "v1", options, settings, new Set(["e2b"]));
  expect(unavailable.error).toContain("unavailable");
  expect(calls).toEqual([]);
});

test("a workspace reporting the wrong API fails and is cleaned up", async () => {
  const { client, calls } = mockClient("v1");
  const result = await runPair(client, "e2b", "v2", options, settings, new Set(["e2b"]));
  expect(result.error).toContain("Workspace did not select running e2b/v2");
  expect(calls).toEqual(["create", "terminate"]);
});

test("completion without a permission request fails with actionable diagnostics", async () => {
  const { client, calls } = mockClient("v1");
  const run: AgentRun = {
    id: "run-no-permission",
    workspaceId: "workspace-test",
    title: "permission",
    status: "completed",
    pendingInputs: [],
    finalText: "smoke-ok",
    error: null,
    context: { type: "isolated" },
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  client.runs = {
    async create() {
      return run;
    },
    async *events() {
      yield { type: "run.completed", run };
    },
  } as GittermClient["runs"];
  const result = await runPair(client, "e2b", "v1", options, settings, new Set(["e2b"]));
  expect(result.error).toContain("input observed: false");
  expect(result.error).toContain("workspace permission config");
  expect(result.error).toContain("run-no-permission");
  expect(result.cleanup).toBe("terminated");
  expect(calls).toEqual(["create", "terminate"]);
});

for (const api of ["v1", "v2"] as const) {
  test(`${api}: managed permission and question flows require replies, resolution, and tool results`, async () => {
    const { client, calls } = mockClient(api);
    let run: AgentRun;
    let request: AgentRunInputRequest;
    let text: string;
    let tool: string;
    client.runs = {
      async create(input) {
        const permission = input.title?.endsWith("permission");
        calls.push(permission ? "permission" : "question");
        text = permission ? input.prompt.match(/echo (smoke-ok-[\w-]+)/)![1]! : "chosen=Approach A";
        tool = permission ? (api === "v1" ? "bash" : "shell") : "question";
        const common = { id: "request-test", createdAt: null, toolCallId: "call-test" };
        request = permission
          ? {
              ...common,
              kind: "permission",
              title: "echo",
              permission: tool,
              patterns: ["echo *"],
              always: [],
            }
          : {
              ...common,
              kind: "question",
              questions: [
                {
                  key: "choice",
                  header: "Approach",
                  question: "Which approach?",
                  multiple: false,
                  custom: false,
                  options: [{ label: "Approach A", description: "First option" }],
                },
              ],
            };
        run = {
          id: "run-test",
          workspaceId: "workspace-test",
          title: input.title!,
          status: "awaiting_input",
          pendingInputs: [request],
          finalText: null,
          error: null,
          context: { type: "isolated" },
          createdAt: new Date().toISOString(),
          submittedAt: new Date().toISOString(),
          completedAt: null,
        };
        return run;
      },
      async *events() {
        yield { type: "input.required", run, request };
        yield { type: "input.resolved", run, requestId: request.id };
        yield { type: "run.completed", run };
      },
      async get() {
        return run;
      },
      async respond(_ref, input) {
        expect(input.requestId).toBe(request.id);
        expect(input.reply).toEqual(
          request.kind === "permission"
            ? { type: "permission", response: "once" }
            : { type: "question", answers: { choice: ["Approach A"] } },
        );
        calls.push("respond");
        run = { ...run, status: "completed", pendingInputs: [], finalText: text };
        return run;
      },
      async messages() {
        return [
          {
            id: "message-test",
            role: "assistant",
            createdAt: new Date().toISOString(),
            completedAt: null,
            text,
            error: null,
            parts: [
              {
                type: "tool",
                tool,
                status: "completed",
                callId: "call-test",
                title: null,
                input: {},
                output: text,
                error: null,
                startedAt: null,
                completedAt: null,
              },
            ],
          },
        ];
      },
      async cancel() {
        calls.push("cancel");
        return { cancelled: true };
      },
    } as GittermClient["runs"];
    const result = await runPair(client, "e2b", api, options, settings, new Set(["e2b"]));
    expect(result.error).toBeUndefined();
    expect(result.cleanup).toBe("terminated");
    expect(calls).toEqual(["create", "permission", "respond", "question", "respond", "terminate"]);
  });
}

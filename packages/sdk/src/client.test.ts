import { describe, expect, test } from "bun:test";
import { GittermError, WorkspaceLifecycleError } from "./errors";
import { createGittermClient } from "./client";
import type { WorkspaceCreateInput, WorkspaceProviderSelection } from "./types";

describe("createGittermClient", () => {
  test("uses the hosted API when only a token is supplied", () => {
    const client = createGittermClient({
      token: "gt_test",
      configPath: "/path/that/does/not/exist",
    });
    expect(client.serverUrl).toBe("https://api.gitterm.dev");
  });
});

const awsSelection: WorkspaceProviderSelection = {
  type: "aws",
  region: "us-east-1",
  machine: { type: "profile", key: "rendering" },
};

// @ts-expect-error E2B placement does not accept a caller-selected region.
const invalidE2bSelection: WorkspaceProviderSelection = { type: "e2b", region: "us-east-1" };

const invalidE2bMachine: WorkspaceProviderSelection = {
  type: "e2b",
  // @ts-expect-error E2B templates are profile-only; custom CPU/RAM is unsupported.
  machine: { type: "custom", resources: { cpu: 4 } },
};

test("provider selections retain their discriminated fields", () => {
  expect(awsSelection.type === "aws" && awsSelection.region).toBe("us-east-1");
  expect(invalidE2bSelection.type).toBe("e2b");
  expect(invalidE2bMachine.type).toBe("e2b");
});

const phasedSetup: WorkspaceCreateInput = {
  repo: "https://github.com/gitterm/example",
  repositoryCredentials: { token: "github-pat" },
  setup: { beforeAgent: ["bun install"], afterAgent: ["bun test"] },
  secretFiles: [{ path: ".env", content: "TOKEN=secret", mode: "0400" }],
};

test("hosted workspace input exposes phased setup and strict secret modes", () => {
  expect(phasedSetup.setup?.beforeAgent).toEqual(["bun install"]);
  expect(phasedSetup.secretFiles?.[0]?.mode).toBe("0400");
  expect(phasedSetup.repositoryCredentials?.token).toBe("github-pat");
});

test("maps stable lifecycle prefixes to WorkspaceLifecycleError", async () => {
  const fetchStub = (async () =>
    new Response(
      JSON.stringify([
        {
          error: {
            message: "WORKSPACE_NOT_RUNNING: workspace is paused",
            code: -32600,
            data: { code: "BAD_REQUEST", httpStatus: 400, path: "run.create" },
          },
        },
      ]),
      { status: 400, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  const client = createGittermClient({ token: "gt_test", fetch: fetchStub });

  const error = await client.runs
    .create({ workspace: crypto.randomUUID(), idempotencyKey: "k", prompt: "hi" })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(WorkspaceLifecycleError);
  expect((error as WorkspaceLifecycleError).code).toBe("WORKSPACE_NOT_RUNNING");
});

test.each([
  ["WORKSPACE_NOT_RUNNING", "Workspace must be running", "WORKSPACE_NOT_RUNNING"],
  ["WORKSPACE_TERMINATED", "This workspace is gone", "WORKSPACE_TERMINATED"],
  ["WORKSPACE_START_TIMEOUT", "Startup took too long", "WORKSPACE_START_TIMEOUT"],
  // Structured data takes precedence even if the message contains another prefix.
  ["WORKSPACE_NOT_RUNNING", "WORKSPACE_TERMINATED: misleading text", "WORKSPACE_NOT_RUNNING"],
  ["UNKNOWN_CODE", "Invalid request", "BAD_REQUEST"],
  [null, "An example mentions WORKSPACE_NOT_RUNNING but is not that error", "BAD_REQUEST"],
  [null, "WORKSPACE_NOT_RUNNING: workspace is paused", "WORKSPACE_NOT_RUNNING"],
] as const)(
  "maps lifecycle data %s with message %s to %s",
  async (workspaceLifecycleCode, message, expected) => {
    const fetchStub = (async () =>
      new Response(
        JSON.stringify([
          {
            error: {
              message,
              code: -32600,
              data: {
                code: "BAD_REQUEST",
                httpStatus: 400,
                path: "run.create",
                workspaceLifecycleCode,
              },
            },
          },
        ]),
        { status: 400, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const client = createGittermClient({ token: "gt_test", fetch: fetchStub });
    const error = await client.runs
      .create({ workspace: crypto.randomUUID(), prompt: "hi" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GittermError);
    expect((error as GittermError).code).toBe(expected);
    if (expected !== "BAD_REQUEST") expect(error).toBeInstanceOf(WorkspaceLifecycleError);
  },
);

function trpcOk(result: unknown): Response {
  return new Response(JSON.stringify([{ result: { data: result } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A tRPC subscription response: one SSE frame per event, then the stream ends. */
function trpcEvents(events: unknown[]): Response {
  const body = [
    "event: connected\ndata: {}\n\n",
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    "event: return\ndata: \n\n",
  ].join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const completed = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  title: "t",
  status: "completed",
  error: null,
  finalText: "done",
  pendingInputs: [],
  context: { type: "isolated" },
  createdAt: "2026-09-03T00:00:00.000Z",
  submittedAt: null,
  completedAt: "2026-09-03T00:00:01.000Z",
};
const awaiting = {
  ...completed,
  status: "awaiting_input",
  finalText: null,
  completedAt: null,
  pendingInputs: [
    {
      id: "per_1",
      kind: "permission",
      createdAt: "2026-09-03T00:00:00.500Z",
      toolCallId: "call_1",
      permission: "bash",
      patterns: ["echo hi"],
      always: ["echo *"],
      title: "bash: echo hi",
    },
  ],
};

function eventClient(frames: unknown[][], seen: string[] = []) {
  let call = 0;
  const fetchStub = (async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
    seen.push(url);
    if (url.includes("run.lifecycle"))
      return trpcEvents(frames[Math.min(call++, frames.length - 1)] ?? []);
    return trpcOk(completed);
  }) as unknown as typeof fetch;
  return createGittermClient({ token: "gt_test", fetch: fetchStub });
}

test("run helpers accept the run object instead of an id pair", async () => {
  const seen: string[] = [];
  const client = eventClient(
    [
      [
        { type: "snapshot", run: { ...completed, status: "running" } },
        { type: "run.updated", run: completed },
      ],
    ],
    seen,
  );

  const result = await client.runs.wait(completed as never);

  expect(result.status).toBe("completed");
  expect(seen[0]).toContain("run.lifecycle");
  expect(seen[0]).toContain(`"runId":"${completed.id}"`);
  expect(seen[0]).toContain(`"workspaceId":"${completed.workspaceId}"`);
});

test("wait returns as soon as the run needs input", async () => {
  const client = eventClient([
    [
      { type: "snapshot", run: { ...completed, status: "running" } },
      { type: "run.updated", run: awaiting },
      { type: "run.updated", run: completed },
    ],
  ]);

  const result = await client.runs.wait({ workspaceId: completed.workspaceId, id: completed.id });
  expect(result.status).toBe("awaiting_input");
  expect(result.pendingInputs[0]?.kind).toBe("permission");
});

test("watch yields every lifecycle state and ends after the terminal one", async () => {
  const client = eventClient([
    [
      { type: "snapshot", run: { ...completed, status: "running" } },
      { type: "run.updated", run: awaiting },
      { type: "run.updated", run: { ...completed, status: "running" } },
      { type: "run.updated", run: completed },
    ],
  ]);

  const statuses: string[] = [];
  for await (const run of client.runs.watch(completed as never)) statuses.push(run.status);
  expect(statuses).toEqual(["running", "awaiting_input", "running", "completed"]);
});

test("wait rejects with TIMEOUT when the run does not settle in time", async () => {
  const fetchStub = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: connected\ndata: {}\n\n"));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )) as unknown as typeof fetch;
  const client = createGittermClient({ token: "gt_test", fetch: fetchStub });

  const error = await client.runs
    .wait(completed as never, { timeoutMs: 20 })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(GittermError);
  expect((error as GittermError).code).toBe("TIMEOUT");
});

test("respond sends question answers keyed by question key", async () => {
  let body: unknown;
  const fetchStub = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return trpcOk(completed);
  }) as unknown as typeof fetch;
  const client = createGittermClient({ token: "gt_test", fetch: fetchStub });

  await client.runs.respond(completed as never, {
    requestId: "que_1",
    reply: { type: "question", answers: { database: ["Postgres"] } },
  });

  expect(body).toMatchObject({
    "0": { workspaceId: completed.workspaceId, runId: completed.id, requestId: "que_1" },
  });
  expect((body as { "0": { reply: unknown } })["0"].reply).toEqual({
    type: "question",
    answers: { database: ["Postgres"] },
  });
});

test("model discovery includes logical provider keys and workspace configuration", async () => {
  const client = createGittermClient({
    token: "gt_test",
    fetch: (async (input) => {
      const url = String(input);
      if (url.includes("listProviders"))
        return trpcOk({
          providers: [
            {
              id: "oauth",
              name: "openai-oauth",
              logicalProviderKey: "openai",
              displayName: "OpenAI",
              authType: "oauth",
              isRecommended: true,
            },
          ],
        });
      if (url.includes("getModelAccess"))
        return trpcOk({
          providers: [{ provider: "openai", source: "saved", label: "work", active: true }],
          models: [],
        });
      return trpcOk({
        models: [
          { modelId: "openai/test", displayName: "Test", isFree: false, isRecommended: true },
        ],
      });
    }) as typeof fetch,
  });
  expect((await client.credentials.listProviders())[0]?.logicalProviderKey).toBe("openai");
  expect((await client.models.list({ provider: "openai" }))[0]?.id).toBe("openai/test");
  expect((await client.workspaces.models("workspace")).providers[0]?.label).toBe("work");
});

test("stale reply errors retain a stable code", async () => {
  const client = createGittermClient({
    token: "gt_test",
    fetch: (async () =>
      Response.json(
        [
          {
            error: {
              message: "INPUT_NOT_PENDING: Input request was resolved",
              code: -32009,
              data: { code: "CONFLICT", httpStatus: 409, path: "run.respond" },
            },
          },
        ],
        { status: 409 },
      )) as unknown as typeof fetch,
  });
  await expect(
    client.runs.respond(completed, {
      requestId: "old",
      reply: { type: "permission", response: "once" },
    }),
  ).rejects.toMatchObject({ code: "INPUT_NOT_PENDING" });
});

test("wait with until: terminal skips the awaiting_input stop", async () => {
  const client = eventClient([
    [
      { type: "snapshot", run: awaiting },
      { type: "run.updated", run: completed },
    ],
  ]);
  const result = await client.runs.wait(completed as never, { until: "terminal" });
  expect(result.status).toBe("completed");
});

test("waits reject with ABORTED when the signal is already aborted", async () => {
  const fetchStub = (async () => {
    throw new Error("network should not be reached");
  }) as unknown as typeof fetch;
  const client = createGittermClient({ token: "gt_test", fetch: fetchStub });
  const controller = new AbortController();
  controller.abort();

  const error = await client.runs
    .wait(
      {
        workspaceId: "22222222-2222-4222-8222-222222222222",
        id: "11111111-1111-4111-8111-111111111111",
      },
      { signal: controller.signal },
    )
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(GittermError);
  expect((error as GittermError).code).toBe("ABORTED");
});

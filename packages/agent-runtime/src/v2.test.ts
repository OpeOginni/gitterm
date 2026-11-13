import { describe, expect, test } from "bun:test";
import {
  createV2Runtime,
  formRequest,
  normalizeMessage,
  parseV2Signal,
  selectRunMessages,
} from "./v2";
import { PASSIVE_REQUEST_HEADER } from "./http";
import { parseModelRef } from "./types";
import { deriveRunState, LOST_WORK_MESSAGE } from "./derive";

test("model references split the native variant from provider and model IDs", () => {
  expect(parseModelRef("openai/gpt-6.1-sol#high")).toEqual({
    providerID: "openai",
    modelID: "gpt-6.1-sol",
    variant: "high",
  });
  expect(parseModelRef("openrouter/team/model")).toEqual({
    providerID: "openrouter",
    modelID: "team/model",
  });
  expect(() => parseModelRef("openai/model#")).toThrow("provider/model");
  expect(() => parseModelRef("openai/model#high#extra")).toThrow("provider/model");
});

// Payloads captured from `opencode2 serve` 0.0.0-beta-19059 (`GET /api/event`).
const permissionAsked = {
  id: "evt_06b8f9d270011KXtNOhD53LrfD",
  created: 1788510969127,
  type: "permission.asked",
  location: { directory: "/tmp/spike" },
  data: {
    id: "per_06b8f9d26001sAgGS7siFWviWo",
    sessionID: "ses_f947069f0ffeDT7MRDXufloUDC",
    action: "shell",
    resources: ["echo beta3-ok"],
    save: ["echo *"],
    source: {
      type: "tool",
      messageID: "msg_06b8f966d001amo4t1UFAidKsp",
      id: "call_afcc5593e2f0480bb49a4308",
    },
  },
};

const formCreated = {
  id: "evt_06b8eeda2001iNlaJfl15MkCUM",
  created: 1788510924194,
  type: "form.created",
  location: { directory: "/tmp/spike" },
  data: {
    form: {
      id: "frm_06b8eeda10012Ji114jBaH5Fez",
      sessionID: "ses_f9471234affeXUPut47TQKvksY",
      title: "Questions",
      metadata: {
        kind: "question",
        tool: { messageID: "msg_06b8edd0f001K6n649j5zSyV4d", id: "call_42e246e9335e46e190f29f0a" },
      },
      fields: [
        {
          key: "q0",
          title: "Approach Selection",
          description: "Which approach would you like to proceed with?",
          type: "string",
          options: [
            { value: "Approach A", label: "Approach A", description: "Proceed with approach A" },
            { value: "Approach B", label: "Approach B", description: "Proceed with approach B" },
          ],
          custom: true,
        },
      ],
    },
  },
};

// `GET /api/session/{id}/message?order=asc` on the same build.
const messages = [
  {
    type: "user",
    id: "msg_spike000000000000000000009",
    time: { created: 1788510430951 },
    text: "Run the shell command `echo beta-ok` using the bash tool and report its output.",
  },
  {
    type: "assistant",
    id: "msg_06b8766f8001kB71RZC7bs4o4r",
    time: { created: 1788510435988, streamed: 1788510436212, completed: 1788510523078 },
    finish: "tool-calls",
    agent: "build",
    model: { id: "big-pickle", providerID: "opencode" },
    content: [
      { type: "reasoning", text: "The user wants me to run a simple shell command." },
      {
        type: "tool",
        id: "call_18b2e5d25f61474d9aff6753",
        name: "shell",
        state: {
          status: "completed",
          input: { command: "echo beta-ok" },
          content: [
            { type: "text", text: "beta-ok\n" },
            { type: "text", text: "Command exited with code 0." },
          ],
          metadata: { exit: 0 },
        },
        time: { created: 1788510436000, ran: 1788510523000, completed: 1788510523070 },
      },
    ],
  },
  {
    type: "assistant",
    id: "msg_06b88ced1001Z8XGfygEfF37KS",
    time: { created: 1788510525675, streamed: 1788510526107, completed: 1788510526110 },
    finish: "stop",
    agent: "build",
    model: { id: "big-pickle", providerID: "opencode" },
    content: [
      { type: "reasoning", text: "Simple and clear." },
      { type: "text", text: "The command output is:\n\n```\nbeta-ok\n```" },
    ],
  },
  { type: "user", id: "msg_next_turn", time: { created: 1788510600000 }, text: "Another prompt" },
  {
    type: "assistant",
    id: "msg_next_turn_reply",
    time: { created: 1788510600500, completed: 1788510601000 },
    finish: "stop",
    agent: "build",
    model: { id: "big-pickle", providerID: "opencode" },
    content: [{ type: "text", text: "Not part of the first run" }],
  },
];

describe("v2 runtime events", () => {
  test("permission.asked maps action/resources/save onto the shared request shape", () => {
    expect(parseV2Signal(permissionAsked)).toEqual({
      type: "input.asked",
      sessionId: "ses_f947069f0ffeDT7MRDXufloUDC",
      request: expect.objectContaining({
        id: "per_06b8f9d26001sAgGS7siFWviWo",
        kind: "permission",
        permission: "shell",
        patterns: ["echo beta3-ok"],
        always: ["echo *"],
        title: "shell: echo beta3-ok",
        toolCallId: "call_afcc5593e2f0480bb49a4308",
      }),
    });
  });

  test("a question form becomes a question request keyed by field", () => {
    const signal = parseV2Signal(formCreated);
    if (signal?.type !== "input.asked" || signal.request.kind !== "question") {
      throw new Error(`unexpected signal ${JSON.stringify(signal)}`);
    }
    expect(signal.sessionId).toBe("ses_f9471234affeXUPut47TQKvksY");
    expect(signal.request.id).toBe("frm_06b8eeda10012Ji114jBaH5Fez");
    expect(signal.request.toolCallId).toBe("call_42e246e9335e46e190f29f0a");
    expect(signal.request.questions).toEqual([
      {
        key: "q0",
        header: "Approach Selection",
        question: "Which approach would you like to proceed with?",
        options: [
          { label: "Approach A", description: "Proceed with approach A" },
          { label: "Approach B", description: "Proceed with approach B" },
        ],
        multiple: false,
        custom: true,
      },
    ]);
  });

  test("form mapping normalises copied custom slots and options", () => {
    const request = formRequest({
      id: "frm_1",
      fields: [
        {
          key: "approach",
          title: "Which approach?",
          type: "select",
          custom: false,
          options: [
            { label: " First ", description: " First approach ", value: "first" },
            { label: "First", description: "Duplicate", value: "second" },
            { label: " ", description: "Blank" },
            { label: "Type your own answer...", description: "Other" },
          ],
        },
      ],
    });
    if (request.kind !== "question") throw new Error();
    expect(request.questions[0]?.options).toEqual([
      { label: "First", description: "First approach", value: "first" },
    ]);
    expect(request.questions[0]?.custom).toBe(true);
  });

  test.each([
    { name: "omitted", flags: {}, expected: true },
    { name: "false", flags: { custom: false }, expected: false },
    { name: "true", flags: { custom: true }, expected: true },
  ])("custom $name maps to $expected", ({ flags, expected }) => {
    const request = formRequest({
      id: "frm_1",
      fields: [{ key: "q0", title: "What should we do?", type: "string", options: [], ...flags }],
    });
    if (request.kind !== "question") throw new Error();
    expect(request.questions[0]?.custom).toBe(expected);
    expect(request.questions[0]?.multiple).toBe(false);
  });

  test("option values that differ from labels are kept so replies submit the value", () => {
    const request = formRequest({
      id: "frm_1",
      sessionID: "ses_1",
      fields: [
        {
          key: "env",
          title: "Environment",
          type: "multiselect",
          options: [{ value: "prod", label: "Production", description: "" }],
        },
      ],
    });
    if (request.kind !== "question") throw new Error();
    expect(request.questions[0]?.options).toEqual([
      { label: "Production", description: "", value: "prod" },
    ]);
    expect(request.questions[0]?.multiple).toBe(true);
  });

  test("execution and step events drive status and change signals", () => {
    const data = { sessionID: "ses_1" };
    expect(parseV2Signal({ type: "session.execution.started", data })).toEqual({
      type: "session.status",
      sessionId: "ses_1",
      status: "busy",
    });
    expect(parseV2Signal({ type: "session.execution.succeeded", data })).toEqual({
      type: "session.status",
      sessionId: "ses_1",
      status: "idle",
    });
    expect(
      parseV2Signal({ type: "session.step.ended", data: { ...data, finish: "stop" } }),
    ).toEqual({ type: "session.changed", sessionId: "ses_1" });
    expect(parseV2Signal({ type: "session.tool.success", data })).toEqual({
      type: "session.changed",
      sessionId: "ses_1",
    });
    expect(
      parseV2Signal({
        type: "permission.replied",
        data: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
      }),
    ).toEqual({ type: "input.resolved", sessionId: "ses_1", requestId: "per_1" });
    expect(
      parseV2Signal({ type: "form.replied", data: { id: "frm_1", sessionID: "ses_1" } }),
    ).toEqual({ type: "input.resolved", sessionId: "ses_1", requestId: "frm_1" });
    expect(parseV2Signal({ type: "catalog.updated", data: {} })).toBeNull();
  });
});

describe("v2 message snapshots", () => {
  test("a run owns its user message and the assistant messages up to the next user turn", () => {
    const selected = selectRunMessages(messages, "msg_spike000000000000000000009");
    expect(selected.map((message) => message.id)).toEqual([
      "msg_spike000000000000000000009",
      "msg_06b8766f8001kB71RZC7bs4o4r",
      "msg_06b88ced1001Z8XGfygEfF37KS",
    ]);
    expect(selectRunMessages(messages, "msg_unknown")).toEqual([]);
  });

  test("assistant content maps onto the stored part shape", () => {
    const normalized = normalizeMessage(messages[1]!);
    expect(normalized.role).toBe("assistant");
    expect(normalized.completedAt).toBe("2026-09-04T08:28:43.078Z");
    expect(normalized.parts).toEqual([
      {
        type: "tool",
        callId: "call_18b2e5d25f61474d9aff6753",
        tool: "shell",
        status: "completed",
        title: null,
        input: { command: "echo beta-ok" },
        output: "beta-ok\n\nCommand exited with code 0.",
        error: null,
        startedAt: "2026-09-04T08:28:43.000Z",
        completedAt: "2026-09-04T08:28:43.070Z",
      },
    ]);
    const text = normalizeMessage(messages[2]!);
    expect(text.text).toBe("The command output is:\n\n```\nbeta-ok\n```");
    expect(text.parts).toEqual([
      { type: "text", text: "The command output is:\n\n```\nbeta-ok\n```" },
    ]);
  });

  test("user messages carry their text as a single part", () => {
    expect(normalizeMessage(messages[0]!)).toEqual({
      id: "msg_spike000000000000000000009",
      role: "user",
      createdAt: "2026-09-04T08:27:10.951Z",
      completedAt: null,
      text: "Run the shell command `echo beta-ok` using the bash tool and report its output.",
      parts: [
        {
          type: "text",
          text: "Run the shell command `echo beta-ok` using the bash tool and report its output.",
        },
      ],
      error: null,
    });
  });
});

test("snapshots page newest-first through the prompt and preserve supersession", async () => {
  const history = Array.from({ length: 150 }, (_, n) => ({ id: `old_${n}`, type: "user" }));
  const prompt = { id: "run_prompt", type: "user", text: "run" };
  const replies = Array.from({ length: 50 }, (_, n) => ({
    id: `reply_${n}`,
    type: "assistant",
    time: { created: 1, completed: 2 },
    content: [{ type: "text", text: `reply ${n}` }],
  }));
  const newestFirst = [
    ...history,
    prompt,
    ...replies,
    { id: "next_prompt", type: "user" },
  ].toReversed();
  const pages: URL[] = [];
  const runtime = createV2Runtime({
    url: "http://opencode.test",
    directory: "/w",
    password: null,
    fetch: (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/message")) {
        pages.push(url);
        const offset = Number(url.searchParams.get("cursor") ?? 0);
        const limit = Number(url.searchParams.get("limit"));
        return Response.json({
          data: newestFirst.slice(offset, offset + limit),
          cursor: { next: String(offset + limit) },
        });
      }
      const data =
        url.pathname.endsWith("/permission") ||
        url.pathname.endsWith("/form") ||
        url.pathname.endsWith("/job") ||
        url.pathname.endsWith("/inbox")
          ? []
          : {};
      return Response.json({ data });
    }) as typeof fetch,
  });
  const snapshot = await runtime.snapshot("ses_test", prompt.id);
  expect(snapshot.messages.map((message) => message.id)).toEqual(
    [prompt, ...replies].map((message) => message.id),
  );
  expect(snapshot.finalText).toBe("reply 49");
  expect(snapshot.superseded).toBe(true);
  // The run is quiet, so its messages are read again after that was established.
  expect(pages).toHaveLength(4);
  expect(pages[0]!.searchParams.get("order")).toBe("desc");
  expect(pages[1]!.searchParams.has("order")).toBe(false);
});

test("reading a run is marked passive, so it is not counted as use of the workspace; aborting is not", async () => {
  const requests: Array<{ call: string; passive: boolean }> = [];
  const runtime = createV2Runtime({
    url: "http://opencode.test",
    directory: "/w",
    password: null,
    fetch: (async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push({
        call: `${request.method} ${url.pathname}`,
        passive: request.headers.has(PASSIVE_REQUEST_HEADER),
      });
      if (request.method === "POST") return Response.json({ data: {} });
      const list =
        url.pathname.endsWith("/permission") ||
        url.pathname.endsWith("/form") ||
        url.pathname.endsWith("/job") ||
        url.pathname.endsWith("/inbox") ||
        url.pathname === "/api/session" ||
        url.pathname.endsWith("/message");
      return Response.json(list ? { data: [], cursor: { next: null } } : { data: {} });
    }) as typeof fetch,
  });
  await runtime.snapshot("ses_test", "run_prompt");
  expect(requests.length).toBeGreaterThanOrEqual(5);
  expect(requests.every((request) => request.passive)).toBe(true);

  requests.length = 0;
  await runtime.abort("ses_test");
  expect(requests.some((request) => request.call === "POST /api/session/ses_test/interrupt")).toBe(
    true,
  );
  expect(requests.every((request) => !request.passive)).toBe(true);
});

describe("background subagents", () => {
  const subagent = (started: number, childSessionID = "ses_child", status = "running") => ({
    kind: "subagent",
    id: `job_${childSessionID}`,
    sessionID: "ses_test",
    status,
    time: { started },
    childSessionID,
    agent: "general",
    description: "Child",
  });
  const report = (childID = "ses_child") => ({
    id: "msg_report",
    sessionID: "ses_test",
    type: "synthetic",
    delivery: "steer",
    payload: { text: "<subagent>", metadata: { source: "subagent", childID, state: "completed" } },
  });
  // The run started ses_child; its tool part carries the child's session ID.
  const runMessages = [
    {
      id: "reply",
      type: "assistant",
      time: { created: 110, completed: 120 },
      content: [
        {
          type: "tool",
          name: "subagent",
          state: { status: "completed", metadata: { sessionID: "ses_child" } },
        },
        { type: "text", text: "Started a subagent" },
      ],
    },
    { id: "run_prompt", type: "user", text: "run", time: { created: 100 } },
  ];

  type Server = {
    jobs: unknown[];
    inbox: Record<string, unknown[]>;
    active: string[];
    /** Each subagent session's parent. ses_child, which the run started, is always there. */
    parents?: Record<string, string>;
    /** When each subagent session was created; the run's prompt is at 100. */
    created?: Record<string, number>;
    /** Messages per read, newest first; defaults to `runMessages`. */
    messages?: () => unknown[];
    /** Requests to this path never answer. */
    hang?: string;
    /** Shells OpenCode still has; a shell job's shell may be missing after a restart. */
    shells?: string[];
    /** The job list read after the first one, when it differs. */
    jobsAgain?: unknown[];
  };
  function fakeRuntime(server: Server, requests: string[] = [], onPost?: (path: string) => void) {
    return createV2Runtime({
      url: "http://opencode.test",
      directory: "/w",
      password: null,
      fetch: (async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        if (url.pathname === server.hang)
          return new Promise<Response>((_, reject) =>
            request.signal.addEventListener("abort", () => reject(request.signal.reason)),
          );
        if (request.method !== "GET") {
          onPost?.(url.pathname);
          return Response.json({ data: { interrupted: true } });
        }
        if (url.pathname.endsWith("/job")) {
          const jobs = server.jobs;
          if (server.jobsAgain) server.jobs = server.jobsAgain;
          return Response.json({ data: jobs });
        }
        if (url.pathname === "/api/shell")
          return Response.json({
            location: { directory: "/w" },
            data: (server.shells ?? []).map((id) => ({ id, status: "running" })),
          });
        if (url.pathname.endsWith("/inbox"))
          return Response.json({ data: server.inbox[url.pathname.split("/")[3]!] ?? [] });
        if (url.pathname === "/api/session/active")
          return Response.json({ data: Object.fromEntries(server.active.map((id) => [id, {}])) });
        if (url.pathname.endsWith("/message"))
          return Response.json({
            data: server.messages?.() ?? runMessages,
            cursor: { next: null },
          });
        if (url.pathname === "/api/session") {
          const parents = { ses_child: "ses_test", ...server.parents };
          const parentID = url.searchParams.get("parentID");
          return Response.json({
            data: Object.entries(parents)
              .filter(([, parent]) => parent === parentID)
              .map(([id]) => ({ id, parentID, time: { created: server.created?.[id] ?? 105 } })),
            cursor: {},
          });
        }
        const session = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1];
        if (session)
          return Response.json({ data: { id: session, parentID: server.parents?.[session] } });
        const list = url.pathname.endsWith("/permission") || url.pathname.endsWith("/form");
        return Response.json({ data: list ? [] : {} });
      }) as typeof fetch,
    });
  }
  const status = async (server: Server) =>
    deriveRunState(await fakeRuntime(server).snapshot("ses_test", "run_prompt"), {
      submittedAt: null,
    }).status;

  test("a run is still working while a subagent it started has not reported back", async () => {
    expect(await status({ jobs: [subagent(105)], inbox: {}, active: ["ses_child"] })).toBe(
      "running",
    );
  });

  test("the snapshot names the run's working subagents, not settled or older ones", async () => {
    const snapshot = await fakeRuntime({
      jobs: [subagent(105), subagent(106, "ses_done", "completed"), subagent(50, "ses_old")],
      inbox: {},
      active: ["ses_child"],
    }).snapshot("ses_test", "run_prompt");
    expect(snapshot.subagents).toEqual([{ id: "ses_child", description: "Child" }]);
  });

  test("a report admitted to the inbox before it wakes the session keeps the run working", async () => {
    // OpenCode removes the job after admitting the report and before waking the session.
    expect(await status({ jobs: [], inbox: { ses_test: [report()] }, active: [] })).toBe("running");
  });

  test("a subagent that is still busy, or has input waiting, keeps the run working", async () => {
    expect(await status({ jobs: [], inbox: {}, active: ["ses_child"] })).toBe("running");
    expect(
      await status({ jobs: [], inbox: { ses_child: [report("ses_grandchild")] }, active: [] }),
    ).toBe("running");
  });

  test("notes that never wake the session, and older runs' subagents, do not hold the run", async () => {
    const note = { ...report(), payload: { text: "note", metadata: { gittermNote: "x" } } };
    expect(
      await status({ jobs: [subagent(50, "ses_old")], inbox: { ses_test: [note] }, active: [] }),
    ).toBe("completed");
  });

  test("a run that finishes between reads completes with its final answer, not the earlier one", async () => {
    const final = {
      id: "final",
      type: "assistant",
      time: { created: 130, completed: 140 },
      content: [{ type: "text", text: "The cookie expires early" }],
    };
    let reads = 0;
    // The first read sees the turn that started the subagent; by the second, its report
    // has been answered.
    const messages = () => (reads++ === 0 ? runMessages : [final, ...runMessages]);
    const snapshot = await fakeRuntime({ jobs: [], inbox: {}, active: [], messages }).snapshot(
      "ses_test",
      "run_prompt",
    );
    expect(snapshot.finalText).toBe("The cookie expires early");
  });

  test("a deeper subagent of this run still working keeps the run working", async () => {
    const server: Server = {
      jobs: [],
      inbox: {},
      active: ["ses_grandchild", "ses_other"],
      parents: { ses_grandchild: "ses_child", ses_other: "ses_elsewhere" },
    };
    expect(await status(server)).toBe("running");
    expect(await status({ ...server, active: ["ses_other"] })).toBe("completed");
  });

  test("a report waiting in a deeper subagent's inbox keeps the run working", async () => {
    // During recovery nothing in the tree is active yet; the report is the only sign.
    const server: Server = {
      jobs: [],
      inbox: { ses_grandchild: [report("ses_great_grandchild")] },
      active: [],
      parents: { ses_grandchild: "ses_child" },
    };
    expect(await status(server)).toBe("running");
  });

  test("subagents an earlier run started do not hold this run", async () => {
    // ses_old was started by an earlier run of the same session and is still working.
    const server: Server = {
      jobs: [],
      inbox: { ses_old: [report("ses_old_child")] },
      active: ["ses_old"],
      parents: { ses_old: "ses_test" },
      created: { ses_old: 50 },
    };
    expect(await status(server)).toBe("completed");
  });

  test("jobs OpenCode lost in a restart fail the run instead of holding it", async () => {
    // A restarted OpenCode can keep listing jobs as running whose subagent never resumes and
    // whose shell is gone; nothing will ever finish them.
    const shell = {
      kind: "shell",
      id: "job_shell",
      sessionID: "ses_child",
      status: "running",
      time: { started: 105 },
      shellID: "sh_1",
      command: "sleep 30",
    };
    const lost = { jobs: [subagent(105), shell], inbox: {}, active: [] };
    const snapshot = await fakeRuntime(lost).snapshot("ses_test", "run_prompt");
    expect(snapshot).toMatchObject({ busy: false, lostWork: true, subagents: [] });
    expect(deriveRunState(snapshot, { submittedAt: null })).toEqual({
      status: "failed",
      errorMessage: LOST_WORK_MESSAGE,
    });
    expect(await status({ ...lost, jobs: [shell], shells: ["sh_1"] })).toBe("running");
  });

  test("a subagent that ends while it is being checked is not taken for lost", async () => {
    // Seen running, then idle: by the second look its job is no longer running and its
    // report is on the way.
    const server = {
      jobs: [subagent(105)],
      jobsAgain: [subagent(105, "ses_child", "completed")],
      inbox: {},
      active: [],
    };
    expect(await status(server)).toBe("running");
  });

  test("only subagent reports in a subagent's inbox hold the run", async () => {
    // A shell notice or prompt marks its session active before its job goes, so it never
    // waits unseen; one still there was parked, like the notices OpenCode leaves after a
    // restart with `resume: false`, and wakes nothing.
    const note = { type: "synthetic", payload: { text: "note", metadata: { gittermNote: "x" } } };
    const shell = {
      type: "synthetic",
      payload: { text: "<shell>", metadata: { source: "shell" } },
    };
    const prompt = { type: "user", payload: { text: "also check the docs" } };
    const inbox = { ses_child: [note, shell, prompt] };
    expect(await status({ jobs: [], inbox, active: [] })).toBe("completed");
    expect(
      await status({ jobs: [], inbox: { ses_child: [report("ses_grandchild")] }, active: [] }),
    ).toBe("running");
  });

  test("cancelling stops a subagent its own work woke, though it has no job", async () => {
    const server: Server = {
      jobs: [],
      inbox: {},
      active: ["ses_child"],
    };
    const interrupts: string[] = [];
    await fakeRuntime(server, [], (path) => {
      interrupts.push(path);
      if (path === "/api/session/ses_child/interrupt") server.active = [];
    }).abort("ses_test");
    expect(interrupts).toContain("/api/session/ses_child/interrupt");
  });

  test("cancelling stops within its deadline even when OpenCode does not answer", async () => {
    const requests: string[] = [];
    const server: Server = { jobs: [], inbox: {}, active: [], hang: "/api/session/active" };
    const started = Date.now();
    await expect(fakeRuntime(server, requests).abort("ses_test")).rejects.toThrow(
      "OpenCode kept working after the run was cancelled",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    // Nothing is sent once cancelling has given up.
    const sent = requests.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(requests).toHaveLength(sent);
  });

  test("cancelling keeps stopping the session until no subagent report can wake it", async () => {
    const server: Server = { jobs: [subagent(105)], inbox: {}, active: ["ses_child"] };
    const interrupts: string[] = [];
    let wakes = 0;
    await fakeRuntime(server, [], (path) => {
      interrupts.push(path);
      if (path === "/api/session/ses_child/interrupt") {
        // The stopped child reports back, which wakes the session once more.
        server.jobs = [];
        server.active = ["ses_test"];
      } else if (path === "/api/session/ses_test/interrupt" && server.active.includes("ses_test")) {
        wakes++;
        server.active = [];
      }
    }).abort("ses_test");
    expect(interrupts).toContain("/api/session/ses_child/interrupt");
    expect(wakes).toBe(1);
    expect(server.active).toEqual([]);
  });

  test("cancelling gives up when the session will not stop", async () => {
    const server: Server = { jobs: [], inbox: {}, active: ["ses_test"] };
    await expect(fakeRuntime(server).abort("ses_test")).rejects.toThrow(
      "OpenCode kept working after the run was cancelled",
    );
  });
});

describe("prompt", () => {
  test("waits for a freshly started OpenCode to list the model before prompting", async () => {
    const requests: string[] = [];
    let listed = 0;
    // The catalog fills in after startup: the model appears on the third look.
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(`${request.method} ${pathname}`);
        if (pathname !== "/api/model") return new Response(null, { status: 204 });
        const data = ++listed < 3 ? [] : [{ id: "glm", modelID: "glm", providerID: "opencode" }];
        return Response.json({ location: { directory: "/w" }, data });
      },
    });
    try {
      const runtime = createV2Runtime({
        url: `http://localhost:${server.port}`,
        password: null,
        directory: "/w",
      });
      // The fake doesn't model prompt responses; what matters is when the prompt is sent.
      await runtime
        .prompt({ sessionId: "ses_1", messageId: "msg_1", prompt: "hi", model: "opencode/glm" })
        .catch(() => undefined);
    } finally {
      await server.stop(true);
    }
    expect(requests).toEqual([
      "GET /api/model",
      "GET /api/model",
      "GET /api/model",
      "POST /api/session/ses_1/model",
      "POST /api/session/ses_1/prompt",
    ]);
  });
});

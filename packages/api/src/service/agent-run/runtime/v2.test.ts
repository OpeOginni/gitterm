import { describe, expect, test } from "bun:test";
import { formRequest, normalizeMessage, parseV2Signal, selectRunMessages } from "./v2";

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

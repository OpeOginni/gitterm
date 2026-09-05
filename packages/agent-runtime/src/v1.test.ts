import { describe, expect, test } from "bun:test";
import { parseV1Signal, permissionRequest, questionRequest } from "./v1";

// Payloads captured from `opencode serve` 1.18.27 (`GET /event`).
const permissionAsked = {
  id: "evt_06b7591b2002lKIZ6yIH4LTacQ",
  type: "permission.asked",
  properties: {
    id: "per_06b7591b2001h1TdmuWaB1WJE0",
    sessionID: "ses_f948a9fc0ffegdBPFGjHxLHm1M",
    permission: "bash",
    patterns: ["echo spike-ok"],
    metadata: { command: "echo spike-ok" },
    always: ["echo *"],
    tool: { messageID: "msg_06b7563a6001lpZ50Y9auxIps0", callID: "call_66864d4d1a99471c90490bf6" },
  },
};

const questionAsked = {
  id: "evt_06b7aba73001ZUiVCjuGNSvu3J",
  type: "question.asked",
  properties: {
    id: "que_06b7aba720014lQjW0kVwpaJO6",
    sessionID: "ses_f94854cd4ffeS3XwWmS2UDVTxl",
    questions: [
      {
        question: "Which approach would you like to proceed with?",
        header: "Approach Selection",
        options: [
          { label: "Approach A", description: "Proceed with approach A" },
          { label: "Approach B", description: "Proceed with approach B" },
        ],
      },
    ],
    tool: { messageID: "msg_06b7ab34b001zW5fVJGRFh1ld2", callID: "call_380f1729ebe743de9267ca8c" },
  },
};

describe("v1 runtime events", () => {
  test("permission.asked becomes an input request with the tool call attached", () => {
    const signal = parseV1Signal(permissionAsked);
    expect(signal).toEqual({
      type: "input.asked",
      sessionId: "ses_f948a9fc0ffegdBPFGjHxLHm1M",
      request: expect.objectContaining({
        id: "per_06b7591b2001h1TdmuWaB1WJE0",
        kind: "permission",
        permission: "bash",
        patterns: ["echo spike-ok"],
        always: ["echo *"],
        title: "bash: echo spike-ok",
        toolCallId: "call_66864d4d1a99471c90490bf6",
      }),
    });
  });

  test("question.asked keeps every option and defaults single-select", () => {
    const signal = parseV1Signal(questionAsked);
    expect(signal?.type).toBe("input.asked");
    if (signal?.type !== "input.asked" || signal.request.kind !== "question") throw new Error();
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
        custom: false,
      },
    ]);
    expect(signal.request.toolCallId).toBe("call_380f1729ebe743de9267ca8c");
  });

  test("replies and rejections resolve the request by id", () => {
    expect(
      parseV1Signal({
        type: "permission.replied",
        properties: {
          sessionID: "ses_1",
          requestID: "per_1",
          reply: "once",
        },
      }),
    ).toEqual({ type: "input.resolved", sessionId: "ses_1", requestId: "per_1" });
    expect(
      parseV1Signal({
        type: "question.rejected",
        properties: { sessionID: "ses_1", requestID: "que_1" },
      }),
    ).toEqual({ type: "input.resolved", sessionId: "ses_1", requestId: "que_1" });
  });

  test("session lifecycle events map to status signals", () => {
    expect(
      parseV1Signal({
        type: "session.status",
        properties: { sessionID: "ses_1", status: { type: "busy" } },
      }),
    ).toEqual({ type: "session.status", sessionId: "ses_1", status: "busy" });
    expect(parseV1Signal({ type: "session.idle", properties: { sessionID: "ses_1" } })).toEqual({
      type: "session.status",
      sessionId: "ses_1",
      status: "idle",
    });
    expect(
      parseV1Signal({
        type: "message.part.updated",
        properties: { part: { sessionID: "ses_1", type: "text" } },
      }),
    ).toEqual({ type: "session.changed", sessionId: "ses_1" });
    expect(
      parseV1Signal({ type: "session.deleted", properties: { info: { id: "ses_1" } } }),
    ).toEqual({ type: "session.deleted", sessionId: "ses_1" });
    expect(parseV1Signal({ type: "server.heartbeat", properties: {} })).toBeNull();
  });

  test("the older permission.updated shape still yields a usable request", () => {
    expect(
      permissionRequest({
        id: "per_old",
        type: "edit",
        pattern: "src/index.ts",
        sessionID: "ses_1",
        messageID: "msg_1",
        callID: "call_1",
        title: "Edit src/index.ts",
        metadata: {},
        time: { created: 1_788_509_000_000 },
      }),
    ).toEqual({
      id: "per_old",
      kind: "permission",
      createdAt: "2026-09-04T08:03:20.000Z",
      toolCallId: "call_1",
      permission: "edit",
      patterns: ["src/index.ts"],
      always: [],
      title: "Edit src/index.ts",
    });
  });

  test("GET /question entries normalize the same way as events", () => {
    expect(questionRequest(questionAsked.properties).id).toBe("que_06b7aba720014lQjW0kVwpaJO6");
  });
});

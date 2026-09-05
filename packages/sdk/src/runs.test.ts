import { expect, test } from "bun:test";
import { AgentRunError } from "./errors";
import { runHelpers } from "./runs";
import type { AgentPermissionRequest, AgentRun } from "./types";

const request = (id: string): AgentPermissionRequest => ({
  id,
  kind: "permission",
  permission: "bash",
  title: id,
  patterns: [],
  always: [],
  createdAt: null,
  toolCallId: null,
});
const base: AgentRun = {
  id: "run",
  workspaceId: "workspace",
  title: "test",
  status: "running",
  error: null,
  finalText: null,
  pendingInputs: [],
  context: { type: "isolated" },
  createdAt: new Date().toISOString(),
  submittedAt: null,
  completedAt: null,
};
const completed = { ...base, status: "completed" as const, finalText: "done" };

function helpers(states: AgentRun[]) {
  const replies: string[] = [];
  const api = runHelpers({
    async *watch(_ref: AgentRun) {
      yield* states;
    },
    async respond(_ref: AgentRun, input) {
      replies.push(input.requestId);
      return completed;
    },
  });
  return { api, replies };
}

test("result answers each request once across overlapping and replayed snapshots", async () => {
  const a = request("A"),
    b = request("B");
  const { api, replies } = helpers([
    { ...base, status: "awaiting_input", pendingInputs: [a, b] },
    { ...base, status: "awaiting_input", pendingInputs: [b] },
    { ...base, status: "awaiting_input", pendingInputs: [a, b] },
    completed,
  ]);
  expect(await api.result(base, { onPermission: () => "once" })).toEqual(completed);
  expect(replies).toEqual(["A", "B"]);
});
test("events deliver actionable requests, resolved inputs, and a terminal event", async () => {
  const { api } = helpers([
    { ...base, status: "awaiting_input", pendingInputs: [request("A")] },
    completed,
  ]);
  const events = [];
  for await (const event of api.events(base)) events.push(event.type);
  expect(events).toEqual([
    "run.status",
    "input.required",
    "run.status",
    "input.resolved",
    "run.completed",
  ]);
});
test("result fails explicitly on unhandled input and retains the run", async () => {
  const waiting = { ...base, status: "awaiting_input" as const, pendingInputs: [request("A")] };
  const { api, replies } = helpers([waiting]);
  const error = await api.result(base).catch((caught) => caught);
  expect(error).toBeInstanceOf(AgentRunError);
  expect(error.code).toBe("INPUT_REQUIRED");
  expect(error.run).toEqual(waiting);
  expect(replies).toEqual([]);
});
test("deadline also interrupts a handler that never resolves without submitting a reply", async () => {
  const { api, replies } = helpers([
    { ...base, status: "awaiting_input", pendingInputs: [request("A")] },
  ]);
  await expect(
    api.result(base, { timeoutMs: 10, onPermission: () => new Promise(() => {}) }),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(replies).toEqual([]);
});
test("failed and cancelled runs are not successful results", async () => {
  for (const status of ["failed", "cancelled"] as const) {
    const { api } = helpers([{ ...base, status }]);
    await expect(api.result(base)).rejects.toMatchObject({
      code: status === "failed" ? "RUN_FAILED" : "RUN_CANCELLED",
    });
  }
});

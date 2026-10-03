import { expect, test } from "bun:test";
import { inputReferences } from "./privacy";
import { publicRun } from "./public";
import type { AgentRun } from "@gitterm/db/schema/agent-run";

test("pending input persistence strips questions, choices, paths and tool arguments", () => {
  const result = inputReferences([
    {
      id: "per_1",
      kind: "permission",
      createdAt: null,
      toolCallId: "tool-secret",
      permission: "secret-action",
      patterns: ["private-path"],
      always: ["private-path"],
      title: "private-command",
    },
    {
      id: "form_1",
      kind: "question",
      createdAt: null,
      toolCallId: null,
      questions: [
        {
          key: "secret-key",
          header: "secret-title",
          question: "secret-question",
          options: [],
          multiple: false,
          custom: true,
        },
      ],
    },
  ]);
  expect(result.map((item) => item.id)).toEqual(["per_1", "form_1"]);
  expect(JSON.stringify(result)).not.toMatch(/secret|private/);
});

test("metadata events cannot leak even legacy stored conversation content", () => {
  const run = {
    id: "run",
    workspaceId: "workspace",
    title: "secret-title",
    status: "completed",
    errorMessage: "secret-error",
    finalText: "secret-answer",
    messages: [{ text: "secret-prompt" }],
    pendingInputs: [{ question: "secret-question" }],
    createdAt: new Date(),
    submittedAt: null,
    completedAt: new Date(),
    parentRunId: null,
  } as unknown as AgentRun;
  const result = publicRun(run);
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(result.finalText).toBeNull();
  expect(result.pendingInputs).toEqual([]);
});

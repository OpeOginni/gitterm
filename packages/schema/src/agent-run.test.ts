import { expect, test } from "bun:test";
import { runReplySchema } from "./agent-run";
import { workspaceModelsSchema } from "./workspace-models";

test("all permission and question reply forms validate", () => {
  for (const response of ["once", "always", "reject"] as const) {
    expect(runReplySchema.parse({ type: "permission", response })).toEqual({
      type: "permission",
      response,
    });
  }
  expect(runReplySchema.parse({ type: "question", answers: { q0: ["Yes"] } })).toEqual({
    type: "question",
    answers: { q0: ["Yes"] },
  });
  expect(runReplySchema.parse({ type: "question", reject: true })).toEqual({
    type: "question",
    reject: true,
  });
  expect(runReplySchema.safeParse({ type: "question", answers: {}, reject: true }).success).toBe(
    false,
  );
});

test("credential sources are explicit and missing inline keys never select saved credentials", () => {
  for (const source of [
    { source: "apiKey" },
    { source: "apiKey", apiKey: undefined },
    { source: "apiKey", apiKey: " " },
    { label: "work" },
    { source: "saved" },
  ]) {
    expect(workspaceModelsSchema.safeParse({ providers: { openai: source } }).success).toBe(false);
  }
  expect(
    workspaceModelsSchema.parse({ providers: { openai: { source: "saved", label: "work" } } })
      .inherit,
  ).toBe("none");
});

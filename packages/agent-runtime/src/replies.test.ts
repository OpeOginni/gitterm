import { expect, test } from "bun:test";
import { questionAnswers } from "./replies";
import { permissionRequest, questionRequest } from "./v1";
import { formRequest } from "./v2";
import type { QuestionInputRequest } from "./types";

const request: QuestionInputRequest = {
  id: "question",
  kind: "question",
  toolCallId: null,
  createdAt: null,
  questions: [
    {
      key: "env",
      header: "Env",
      question: "Environment?",
      options: [{ label: "Production", value: "prod", description: "" }],
      multiple: false,
      custom: false,
    },
  ],
};
test("keyed answers are validated before any runtime submission", () => {
  expect(questionAnswers(request, { env: ["Production"] })).toEqual([["Production"]]);
  const invalid: Record<string, string[]>[] = [
    {},
    { other: ["Production"] },
    { env: [] },
    { env: ["Production", "Production"] },
    { env: ["prod"] },
  ];
  for (const answers of invalid) {
    expect(() => questionAnswers(request, answers)).toThrow();
  }
});
test("requests do not acquire fresh timestamps on each snapshot", () => {
  expect(permissionRequest({ id: "per" }).createdAt).toBeNull();
  expect(questionRequest({ id: "que" }).createdAt).toBeNull();
  expect(formRequest({ id: "form" }).createdAt).toBeNull();
});

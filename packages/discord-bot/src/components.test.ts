import { describe, expect, test } from "bun:test";
import type { ChatPrompt } from "@gitterm/bot";
import { answerContents, customId, parseCustomId, promptMessage } from "./components.js";

const question = (multiple: boolean): ChatPrompt => ({
  id: "6f1c0b8e-5d1a-4c3e-9a7b-1234567890ab",
  kind: "question",
  index: 0,
  total: 1,
  requester: { id: "42", name: "Alice" },
  question: {
    key: "q",
    header: "Pick",
    question: "Which?",
    options: [
      { label: "A", description: "" },
      { label: "B", description: "" },
    ],
    multiple,
    custom: false,
  },
});

describe("discord components", () => {
  test("custom ids round-trip and fit Discord's limit", () => {
    const id = customId(question(false).id, "o", 1);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(parseCustomId(id)).toEqual({ promptId: question(false).id, control: "o", value: "1" });
    expect(parseCustomId("other:thing")).toBeNull();
  });

  test("single choice uses buttons, multiple choice a select menu", () => {
    const single = promptMessage(question(false)).components.map((row) => row.toJSON());
    expect(single[0]?.components.map((c) => c.type)).toEqual([2, 2]);
    const multi = promptMessage(question(true)).components.map((row) => row.toJSON());
    expect(multi[0]?.components[0]).toMatchObject({ type: 3, max_values: 2 });
  });

  test("answers fit messages and end with the footer as subtext", () => {
    const contents = answerContents("x".repeat(5000), "acme/app · GitTerm");
    expect(contents.every((content) => content.length <= 2000)).toBe(true);
    expect(contents.at(-1)).toEndWith("-# acme/app · GitTerm");
  });
});

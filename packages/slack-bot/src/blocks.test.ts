import { describe, expect, test } from "bun:test";
import type { ChatPrompt } from "@gitterm/bot";
import { answerMessages, promptAttachment, promptIdOf, toMrkdwn } from "./blocks.js";

const question: ChatPrompt = {
  id: "p1",
  kind: "question",
  index: 0,
  total: 2,
  requester: { id: "U1", name: "Alice" },
  question: {
    key: "q",
    header: "Database",
    question: "Which one?",
    options: Array.from({ length: 7 }, (_, i) => ({ label: `Option ${i + 1}`, description: "" })),
    multiple: false,
    custom: true,
  },
};

describe("slack blocks", () => {
  test("markdown becomes mrkdwn outside code", () => {
    expect(toMrkdwn("## Title\n**bold** [docs](https://x.dev)\n```\n**raw**\n```")).toBe(
      "*Title*\n*bold* <https://x.dev|docs>\n```\n**raw**\n```",
    );
  });

  test("long answers split across sections with the footer on the last message", () => {
    const messages = answerMessages("word ".repeat(8000), "acme/app · GitTerm");
    expect(messages.length).toBeGreaterThan(1);
    expect(JSON.stringify(messages.at(-1)?.blocks.at(-1))).toContain("acme/app · GitTerm");
    expect(JSON.stringify(messages[0]?.blocks)).not.toContain("GitTerm");
  });

  test("question buttons carry the prompt id and wrap at five per row", () => {
    const blocks = promptAttachment(question).blocks;
    const rows = blocks.filter((block) => block.type === "actions");
    expect(rows).toHaveLength(3); // 5 + 2 options, then "Write your own answer"
    expect(rows.every((row) => promptIdOf(row.block_id as string) === "p1")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("Question 1 of 2 for <@U1>");
  });
});

test("agent output cannot ping the whole channel", () => {
  expect(JSON.stringify(answerMessages("hey <!channel> and <!here|here>", "f"))).not.toContain(
    "<!",
  );
});

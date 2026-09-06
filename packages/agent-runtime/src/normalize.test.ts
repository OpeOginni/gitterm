import { expect, test } from "bun:test";
import { normalizeQuestion } from "./normalize";
import type { QuestionInputRequest } from "./types";

const question: QuestionInputRequest["questions"][number] = {
  key: "approach",
  header: "Approach",
  question: "Which approach?",
  options: [{ label: "First", description: "First approach", value: "first" }],
  multiple: false,
  custom: false,
};

test.each(["Type your own answer", "TYPE YOUR OWN ANSWER...!"])(
  "removes the copied custom slot %s and enables free text",
  (label) => {
    const input = { ...question, options: [...question.options, { label, description: "Other" }] };
    expect(normalizeQuestion(input)).toEqual({ ...question, custom: true });
    expect(input.options).toHaveLength(2);
    expect(input.custom).toBe(false);
  },
);

test("returns an unchanged question as the same object", () => {
  expect(normalizeQuestion(question)).toBe(question);
});

test("collapses duplicate labels after trimming, keeping the first occurrence", () => {
  expect(
    normalizeQuestion({
      ...question,
      options: [
        ...question.options,
        { label: " First ", description: "Duplicate", value: "second" },
      ],
    }),
  ).toEqual(question);
});

test.each(["", " \t "])("drops empty labels %j without enabling custom", (label) => {
  expect(
    normalizeQuestion({
      ...question,
      options: [...question.options, { label, description: "Blank" }],
    }),
  ).toEqual(question);
});

test("a copied custom slot as the only option leaves an empty free-text question", () => {
  expect(
    normalizeQuestion({
      ...question,
      options: [{ label: "Type your own answer", description: "Other" }],
    }),
  ).toEqual({ ...question, options: [], custom: true });
});

test("trims labels and descriptions while preserving other fields", () => {
  const input = {
    ...question,
    options: [{ label: " First ", description: " First approach\n", value: "first" }],
  };
  const result = normalizeQuestion(input);
  expect(result).toEqual(question);
  expect(input.options[0]?.label).toBe(" First ");
  expect(normalizeQuestion(result)).toBe(result);
});

test("does not fuzzy-match paraphrases or collapse differently cased labels", () => {
  const input = {
    ...question,
    options: [
      ...question.options,
      { label: "first", description: "Different case" },
      { label: "Answer in your own words", description: "Paraphrase" },
      { label: "Type your own answer here", description: "Not the UI label" },
    ],
  };
  expect(normalizeQuestion(input)).toBe(input);
});

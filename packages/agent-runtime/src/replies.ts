import type { QuestionInputRequest } from "./types";

/** Validate the public keyed answer and translate only at the runtime boundary. */
export function questionAnswers(
  request: QuestionInputRequest,
  answers: Record<string, string[]>,
): string[][] {
  const keys = request.questions.map((question) => question.key);
  if (
    Object.keys(answers).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(answers, key))
  ) {
    throw new Error(`Answers must cover exactly the question keys ${JSON.stringify(keys)}`);
  }
  return request.questions.map((question) => {
    const selected = answers[question.key]!;
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      (!question.multiple && selected.length !== 1)
    ) {
      throw new Error(
        `Question "${question.key}" requires ${question.multiple ? "at least one answer" : "one answer"}`,
      );
    }
    if (
      selected.some(
        (answer) =>
          typeof answer !== "string" ||
          !answer.trim() ||
          (!question.custom && !question.options.some((option) => option.label === answer)),
      )
    ) {
      throw new Error(`Invalid answer for question "${question.key}"`);
    }
    if (new Set(selected).size !== selected.length)
      throw new Error(`Duplicate answer for question "${question.key}"`);
    return selected;
  });
}

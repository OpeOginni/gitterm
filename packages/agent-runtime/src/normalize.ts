import type { QuestionInputRequest } from "./types";

export const OPENCODE_CUSTOM_OPTION_LABEL = /^type your own answer\W*$/i;

export function normalizeQuestion(question: QuestionInputRequest["questions"][number]) {
  const options: typeof question.options = [];
  const labels = new Set<string>();
  let changed = false;
  let custom = question.custom;

  for (const option of question.options) {
    const label = option.label.trim();
    const description = option.description.trim();
    if (OPENCODE_CUSTOM_OPTION_LABEL.test(label)) {
      custom = true;
      changed = true;
      continue;
    }
    if (!label || labels.has(label)) {
      changed = true;
      continue;
    }
    labels.add(label);
    if (label !== option.label || description !== option.description) {
      changed = true;
      options.push({ ...option, label, description });
    } else {
      options.push(option);
    }
  }

  return changed ? { ...question, options, custom } : question;
}

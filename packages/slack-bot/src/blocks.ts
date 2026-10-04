import { splitMessage, tablesToCode, type ChatPrompt } from "@gitterm/bot";

/** `action_id`s and `callback_id`s of the interactive parts; adapter.ts routes them. */
export const ACTION = {
  option: /^gitterm_option_\d+$/,
  toggle: "gitterm_toggle",
  submit: "gitterm_submit",
  custom: "gitterm_custom",
  permission: /^gitterm_permission_(once|always|reject)$/,
} as const;
export const CUSTOM_MODAL = "gitterm_custom_modal";
export const CUSTOM_INPUT = "gitterm_custom_text";

const BLOCK_PREFIX = "gitterm";
const BUTTONS_PER_ROW = 5;
const CHECKBOX_LIMIT = 10;
const LABEL_LIMIT = 75;
const SECTION_LIMIT = 2900;
const SECTIONS_PER_MESSAGE = 10;
// Prompts carry a coloured bar so they stand out from the agent's other messages.
const OPEN_COLOR = "#E8A33D";
const SETTLED_COLOR = "#B8BFC7";

type Block = { type: string; block_id?: string; [key: string]: unknown };

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const plain = (text: string, limit = LABEL_LIMIT) => ({
  type: "plain_text" as const,
  text: truncate(text, limit),
});
const context = (text: string): Block => ({
  type: "context",
  elements: [{ type: "mrkdwn", text }],
});
const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });

/** The block id carries the prompt id, so a click needs no other lookup. */
const blockId = (promptId: string, row = 0) => `${BLOCK_PREFIX}|${promptId}|${row}`;
export const promptIdOf = (id: string): string | null => {
  const [prefix, promptId] = id.split("|");
  return prefix === BLOCK_PREFIX && promptId ? promptId : null;
};

/** GitHub-flavoured Markdown to Slack mrkdwn, leaving code blocks alone. */
export function toMrkdwn(markdown: string): string {
  let inCode = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inCode = !inCode;
        return line;
      }
      if (inCode) return line;
      return line
        .replace(/^#{1,6}\s+(.+)$/, "*$1*")
        .replace(/\*\*(.+?)\*\*/g, "*$1*")
        .replace(/~~(.+?)~~/g, "~$1~")
        .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, "<$2|$1>");
    })
    .join("\n");
}

/** The agent's answer as messages of section blocks; the last one carries the footer. */
export function answerMessages(
  markdown: string,
  footer: string,
): Array<{ text: string; blocks: Block[] }> {
  // Agent output never pings a whole channel.
  const quiet = markdown.replace(/<!(channel|here|everyone)[^>]*>/g, "@$1");
  const sections = splitMessage(toMrkdwn(tablesToCode(quiet)), SECTION_LIMIT);
  const messages: Array<{ text: string; blocks: Block[] }> = [];
  for (let index = 0; index < sections.length; index += SECTIONS_PER_MESSAGE) {
    const group = sections.slice(index, index + SECTIONS_PER_MESSAGE);
    const last = index + SECTIONS_PER_MESSAGE >= sections.length;
    messages.push({
      text: group.join("\n\n"),
      blocks: [...group.map(section), ...(last ? [{ type: "divider" }, context(footer)] : [])],
    });
  }
  return messages;
}

function leadIn(prompt: ChatPrompt, mention: boolean): Block {
  const who = mention ? ` for <@${prompt.requester.id}>` : "";
  if (prompt.kind === "permission") return context(`*Approval needed${who}*`);
  const counter = prompt.total > 1 ? `Question ${prompt.index + 1} of ${prompt.total}` : "Question";
  return context(`*${counter}${who}* · ${prompt.question.header}`);
}

function body(prompt: ChatPrompt): Block[] {
  if (prompt.kind === "permission") {
    const { request } = prompt;
    const patterns = request.patterns.filter(Boolean);
    return [
      section(`The agent wants to run *${request.title}*`),
      ...(patterns.length ? [section(`\`\`\`${patterns.join("\n").slice(0, 2800)}\`\`\``)] : []),
    ];
  }
  const { question } = prompt;
  const options = question.options
    .map(
      (option, i) =>
        `${i + 1}. *${option.label}*${option.description ? ` — ${option.description}` : ""}`,
    )
    .join("\n");
  return [section(`*${question.question}*`), ...(options ? [section(options)] : [])];
}

const customButton = {
  type: "button",
  action_id: ACTION.custom,
  text: plain("Write your own answer"),
  value: "custom",
};

function controls(prompt: ChatPrompt): Block[] {
  if (prompt.kind === "permission") {
    return [
      {
        type: "actions",
        block_id: blockId(prompt.id),
        elements: [
          { label: "Allow once", value: "once", style: "primary" },
          { label: "Always allow", value: "always" },
          { label: "Deny", value: "reject", style: "danger" },
        ].map((button) => ({
          type: "button",
          action_id: `gitterm_permission_${button.value}`,
          text: plain(button.label),
          value: button.value,
          ...(button.style ? { style: button.style } : {}),
        })),
      },
      context("Or reply *yes*, *always*, or *no* in this thread."),
    ];
  }
  const { question } = prompt;
  const rows: Block[] = [];
  if (question.multiple && question.options.length > 0) {
    rows.push({
      type: "actions",
      block_id: blockId(prompt.id),
      elements: [
        {
          type: "checkboxes",
          action_id: ACTION.toggle,
          options: question.options.slice(0, CHECKBOX_LIMIT).map((option, i) => ({
            text: plain(option.label),
            ...(option.description ? { description: plain(option.description) } : {}),
            value: String(i),
          })),
        },
        {
          type: "button",
          action_id: ACTION.submit,
          style: "primary",
          text: plain("Submit"),
          value: "submit",
        },
        ...(question.custom ? [customButton] : []),
      ],
    });
  } else {
    for (let start = 0; start < question.options.length; start += BUTTONS_PER_ROW) {
      rows.push({
        type: "actions",
        block_id: blockId(prompt.id, rows.length),
        elements: question.options.slice(start, start + BUTTONS_PER_ROW).map((option, i) => ({
          type: "button",
          action_id: `gitterm_option_${start + i}`,
          text: plain(option.label),
          value: String(start + i),
        })),
      });
    }
    if (question.custom) {
      rows.push({
        type: "actions",
        block_id: blockId(prompt.id, rows.length),
        elements: [customButton],
      });
    }
  }
  const hint =
    question.options.length > 0
      ? question.multiple
        ? "Tick options and press *Submit*, or reply with their numbers (e.g. `1, 3`)."
        : "Press a button or reply with its number."
      : "Reply in this thread with your answer.";
  return [...rows, context(hint)];
}

/** The open prompt as a message attachment (the colour bar), with notification text. */
export function promptAttachment(prompt: ChatPrompt) {
  const fallback =
    prompt.kind === "permission"
      ? `<@${prompt.requester.id}> the agent needs approval: ${prompt.request.title}`
      : `<@${prompt.requester.id}> the agent has a question: ${prompt.question.header}`;
  return {
    color: OPEN_COLOR,
    fallback,
    blocks: [leadIn(prompt, true), ...body(prompt), ...controls(prompt)],
  };
}

/** The prompt once answered or abandoned: controls removed, outcome shown. */
export function settledAttachment(prompt: ChatPrompt, outcome: string) {
  return {
    color: SETTLED_COLOR,
    fallback: outcome,
    blocks: [leadIn(prompt, false), ...body(prompt), context(outcome)],
  };
}

/** Dialog behind "Write your own answer"; `private_metadata` routes the submission back. */
export function customAnswerView(prompt: Extract<ChatPrompt, { kind: "question" }>) {
  return {
    type: "modal" as const,
    callback_id: CUSTOM_MODAL,
    private_metadata: prompt.id,
    title: plain(prompt.question.header || "Your answer", 24),
    submit: plain("Send to the agent"),
    close: plain("Cancel"),
    blocks: [
      section(prompt.question.question),
      {
        type: "input",
        block_id: "answer",
        label: plain("Your answer"),
        element: { type: "plain_text_input", action_id: CUSTOM_INPUT, multiline: true },
      },
    ],
  };
}

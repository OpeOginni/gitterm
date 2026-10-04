import { splitMessage, tablesToCode, type ChatPrompt } from "@gitterm/bot";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const MESSAGE_LIMIT = 1900;
const BUTTONS_PER_ROW = 5;
// Four rows of option buttons leave the fifth for "Write your own answer".
const BUTTON_OPTION_LIMIT = 20;
const SELECT_LIMIT = 25;
const OPEN_COLOR = 0xe8a33d;
const SETTLED_COLOR = 0xb8bfc7;

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

/** `gt:<prompt id>:<control>[:<value>]`; Discord allows 100 characters. */
export const customId = (promptId: string, control: string, value?: string | number) =>
  ["gt", promptId, control, ...(value === undefined ? [] : [String(value)])].join(":");
export function parseCustomId(id: string) {
  const [prefix, promptId, control, value] = id.split(":");
  return prefix === "gt" && promptId && control ? { promptId, control, value } : null;
}

/** The agent's answer as message contents; the last carries the footer as subtext. */
export function answerContents(markdown: string, footer: string): string[] {
  const chunks = splitMessage(tablesToCode(markdown), MESSAGE_LIMIT);
  const last = chunks.length - 1;
  return chunks.map((chunk, index) => (index === last ? `${chunk}\n-# ${footer}` : chunk));
}

function embed(prompt: ChatPrompt, color: number): EmbedBuilder {
  if (prompt.kind === "permission") {
    const patterns = prompt.request.patterns.filter(Boolean).join("\n");
    return new EmbedBuilder()
      .setColor(color)
      .setTitle("Approval needed")
      .setDescription(
        truncate(
          `The agent wants to run **${prompt.request.title}**${patterns ? `\n\`\`\`\n${patterns}\n\`\`\`` : ""}`,
          4000,
        ),
      );
  }
  const { question } = prompt;
  const counter = prompt.total > 1 ? `Question ${prompt.index + 1} of ${prompt.total} · ` : "";
  const options = question.options
    .map(
      (option, i) =>
        `${i + 1}. **${option.label}**${option.description ? ` — ${option.description}` : ""}`,
    )
    .join("\n");
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(truncate(`${counter}${question.header || "Question"}`, 256))
    .setDescription(
      truncate([`**${question.question}**`, options].filter(Boolean).join("\n\n"), 4000),
    );
}

function controls(prompt: ChatPrompt) {
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> =
    [];
  if (prompt.kind === "permission") {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(prompt.id, "p", "once"))
          .setLabel("Allow once")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customId(prompt.id, "p", "always"))
          .setLabel("Always allow")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(customId(prompt.id, "p", "reject"))
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger),
      ),
    );
    return rows;
  }
  const { question } = prompt;
  const options = question.options;
  if (options.length > 0 && (question.multiple || options.length > BUTTON_OPTION_LIMIT)) {
    const shown = options.slice(0, SELECT_LIMIT);
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId(prompt.id, "m"))
          .setPlaceholder(question.multiple ? "Choose one or more" : "Choose one")
          .setMinValues(1)
          .setMaxValues(question.multiple ? shown.length : 1)
          .addOptions(
            shown.map((option, i) => ({
              label: truncate(option.label, 100),
              value: String(i),
              ...(option.description ? { description: truncate(option.description, 100) } : {}),
            })),
          ),
      ),
    );
  } else {
    for (let start = 0; start < options.length; start += BUTTONS_PER_ROW) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          options.slice(start, start + BUTTONS_PER_ROW).map((option, i) =>
            new ButtonBuilder()
              .setCustomId(customId(prompt.id, "o", start + i))
              .setLabel(truncate(option.label, 80))
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      );
    }
  }
  if (question.custom) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId(prompt.id, "c"))
          .setLabel("Write your own answer")
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }
  return rows;
}

export function promptMessage(prompt: ChatPrompt) {
  const hint =
    prompt.kind === "permission"
      ? "Or reply **yes**, **always**, or **no** in this thread."
      : prompt.question.options.length > 0
        ? "Choose below or reply with the option's number."
        : "Reply in this thread or use the button.";
  return {
    content: `<@${prompt.requester.id}> ${hint}`,
    embeds: [embed(prompt, OPEN_COLOR)],
    components: controls(prompt),
    allowedMentions: { users: [prompt.requester.id] },
  };
}

export function settledMessage(prompt: ChatPrompt, outcome: string) {
  return {
    content: "",
    embeds: [
      embed(prompt, SETTLED_COLOR).addFields({ name: "Outcome", value: truncate(outcome, 1024) }),
    ],
    components: [],
  };
}

export function customAnswerModal(prompt: Extract<ChatPrompt, { kind: "question" }>) {
  return new ModalBuilder()
    .setCustomId(customId(prompt.id, "modal"))
    .setTitle(truncate(prompt.question.header || "Your answer", 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("answer")
          .setLabel(truncate(prompt.question.question, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true),
      ),
    );
}

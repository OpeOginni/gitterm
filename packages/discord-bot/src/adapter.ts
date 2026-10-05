import { once } from "node:events";
import type {
  ChatAdapter,
  ChatAnswer,
  ChatEvents,
  ChatFile,
  ChatUser,
  HistoryMessage,
} from "@gitterm/bot";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  IntentsBitField,
  MessageFlags,
  PermissionsBitField,
  ThreadAutoArchiveDuration,
  type Attachment,
  type Interaction,
  type Message,
  type ThreadChannel,
} from "discord.js";
import {
  answerContents,
  customAnswerModal,
  parseCustomId,
  promptMessage,
  settledMessage,
} from "./components.js";

export type DiscordAdapterOptions = {
  /** Bot token from the Discord developer portal. Defaults to `DISCORD_BOT_TOKEN`. */
  token?: string;
  /**
   * A discord.js client you already run, to add the agent to an existing bot. It needs the
   * Guilds, GuildMessages, and MessageContent intents. You log it in and destroy it yourself;
   * `start()` resolves once it is ready. Make sure your own handlers do not also answer the same
   * mentions.
   */
  client?: Client;
};

const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

const THREAD_NAME_LIMIT = 90;
const HISTORY_LIMIT = 100;
const RECENT_MESSAGES = 500;
const NO_MENTIONS = { parse: [] };

/** What the bot needs in a server, for the invite link it logs at startup. */
const INVITE_PERMISSIONS = new PermissionsBitField([
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "CreatePublicThreads",
  "ReadMessageHistory",
  "AddReactions",
  "EmbedLinks",
]);

const userOf = (message: Message): ChatUser => ({
  id: message.author.id,
  name: message.member?.displayName ?? message.author.displayName ?? message.author.username,
});

const file = (attachment: Attachment): ChatFile => ({
  id: attachment.id,
  name: attachment.name,
  mime: attachment.contentType?.split(";")[0] ?? "application/octet-stream",
  size: attachment.size,
  async download() {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(
        `Could not download “${attachment.name}” from Discord (HTTP ${response.status})`,
      );
    }
    return Buffer.from(await response.arrayBuffer()).toString("base64");
  },
});

async function onInteraction(events: ChatEvents, interaction: Interaction) {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isModalSubmit()
  ) {
    return;
  }
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;
  const prompt = events.prompt(parsed.promptId);
  const by: ChatUser = {
    id: interaction.user.id,
    name:
      (interaction.member && "displayName" in interaction.member
        ? interaction.member.displayName
        : undefined) ?? interaction.user.displayName,
  };
  const stale = () =>
    interaction.reply({ content: "This was already answered.", flags: MessageFlags.Ephemeral });

  if (interaction.isButton() && parsed.control === "c") {
    if (prompt?.kind !== "question") return stale();
    return interaction.showModal(customAnswerModal(prompt));
  }

  let answer: ChatAnswer | undefined;
  if (prompt?.kind === "permission" && parsed.control === "p") {
    answer = { kind: "permission", response: parsed.value as "once" | "always" | "reject" };
  } else if (prompt?.kind === "question") {
    const labelAt = (value: string | undefined) => prompt.question.options[Number(value)]?.label;
    const labels =
      interaction.isStringSelectMenu() && parsed.control === "m"
        ? interaction.values.map(labelAt)
        : interaction.isButton() && parsed.control === "o"
          ? [labelAt(parsed.value)]
          : interaction.isModalSubmit() && parsed.control === "modal"
            ? [interaction.fields.getTextInputValue("answer").trim()]
            : [];
    const valid = labels.filter((label): label is string => Boolean(label));
    if (valid.length > 0) answer = { kind: "question", labels: valid };
  }
  const outcome = answer ? events.answer(parsed.promptId, answer, by) : "stale";
  if (outcome === "forbidden") {
    return interaction.reply({
      content: "Only people allowed to use this bot can answer.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (outcome !== "answered") return stale();
  // The engine edits the prompt message with the outcome; only acknowledge here.
  if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
    return interaction.reply({ content: "Sent to the agent.", flags: MessageFlags.Ephemeral });
  }
  return interaction.deferUpdate();
}

/**
 * Discord over the gateway: no public URL needed. Mention the bot in a channel and it opens a
 * thread for the conversation; every thread is one agent session.
 */
export function createDiscordAdapter(options: DiscordAdapterOptions = {}): ChatAdapter {
  const owned = !options.client;
  const token = owned ? (options.token ?? process.env.DISCORD_BOT_TOKEN)?.trim() : undefined;
  if (owned && !token) throw new Error("DISCORD_BOT_TOKEN is required");
  if (options.client) {
    const intents = new IntentsBitField(options.client.options.intents);
    const missing = INTENTS.filter((intent) => !intents.has(intent));
    if (missing.length > 0) {
      throw new Error(
        `The Discord client needs the ${missing.map((intent) => GatewayIntentBits[intent]).join(", ")} intent(s)`,
      );
    }
  }
  const client = options.client ?? new Client({ intents: INTENTS });
  /** Messages reported to the engine, kept so `mark` can react to them until they are done. */
  const recent = new Map<string, Message>();

  const botId = () => client.user?.id ?? "";
  const stripMention = (text: string) =>
    text.replaceAll(`<@${botId()}>`, "").replaceAll(`<@!${botId()}>`, "").trim();

  const thread = async (id: string): Promise<ThreadChannel> => {
    const channel = await client.channels.fetch(id);
    if (!channel?.isThread()) throw new Error(`Discord channel ${id} is not a thread`);
    return channel;
  };

  async function onMessage(events: ChatEvents, message: Message) {
    if (message.author.bot || !message.inGuild()) return;
    const mentioned =
      message.mentions.users.has(botId()) || message.mentions.repliedUser?.id === botId();
    const channel = message.channel;
    let location: { channel: string; thread: string };
    if (channel.isThread()) {
      if (!channel.parentId) return;
      location = { channel: channel.parentId, thread: channel.id };
    } else {
      // Outside threads only mentions matter, and each one opens a thread for its session.
      if (!mentioned || !events.accepts(channel.id) || !("threads" in channel)) return;
      const name = stripMention(message.content).slice(0, THREAD_NAME_LIMIT) || "GitTerm agent";
      const opened = await message.startThread({
        name,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });
      location = { channel: channel.id, thread: opened.id };
    }
    recent.set(message.id, message);
    if (recent.size > RECENT_MESSAGES) recent.delete(recent.keys().next().value as string);
    events.message({
      id: message.id,
      thread: location,
      author: userOf(message),
      text: stripMention(message.content),
      files: [...message.attachments.values()].map(file),
      mentioned,
      inThread: channel.isThread(),
    });
  }

  return {
    platform: "discord",
    displayName: "Discord",

    async start(events) {
      client.on(Events.MessageCreate, (message) => {
        onMessage(events, message).catch((error: unknown) =>
          console.error("Discord message handling failed", error),
        );
      });
      client.on(Events.InteractionCreate, (interaction) => {
        onInteraction(events, interaction).catch((error: unknown) =>
          console.error("Discord interaction handling failed", error),
        );
      });
      if (!client.isReady()) {
        const ready = once(client, Events.ClientReady);
        if (owned) await client.login(token);
        await ready;
      }
      const applicationId = client.application?.id ?? client.user?.id ?? "";
      console.info(
        `Invite the bot: https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot&permissions=${INVITE_PERMISSIONS.bitfield}`,
      );
      return { scope: applicationId };
    },

    async stop() {
      if (owned) await client.destroy();
    },

    async history(location, after) {
      const channel = await thread(location.thread);
      const fetched = await channel.messages.fetch({
        limit: HISTORY_LIMIT,
        ...(after ? { after } : {}),
      });
      const messages = [...fetched.values()].toReversed();
      // A thread opened on a message starts with that message, which lives in the parent channel.
      if (!after) {
        const starter = await channel.fetchStarterMessage().catch(() => null);
        if (starter) messages.unshift(starter);
      }
      return messages.map(
        (message): HistoryMessage => ({
          id: message.id,
          author: message.author.bot
            ? { id: message.author.id, name: "assistant" }
            : userOf(message),
          fromBot: message.author.bot,
          text: stripMention(message.content),
          files: [...message.attachments.values()].map(file),
        }),
      );
    },

    async post(location, text) {
      const sent = await (
        await thread(location.thread)
      ).send({ content: text, allowedMentions: NO_MENTIONS });
      return sent.id;
    },

    async edit(location, messageId, text) {
      await (await thread(location.thread)).messages.edit(messageId, { content: text });
    },

    async remove(location, messageId) {
      await (await thread(location.thread)).messages.delete(messageId);
    },

    async reply(location, markdown, footer) {
      const channel = await thread(location.thread);
      // Agent output never pings anyone.
      for (const content of answerContents(markdown, footer)) {
        await channel.send({ content, allowedMentions: NO_MENTIONS });
      }
    },

    async ask(location, prompt) {
      const sent = await (await thread(location.thread)).send(promptMessage(prompt));
      return sent.id;
    },

    async settle(location, messageId, prompt, outcome) {
      await (
        await thread(location.thread)
      ).messages.edit(messageId, settledMessage(prompt, outcome));
    },

    async mark(message, state) {
      await recent.get(message.id)?.react({ seen: "👀", done: "✅", failed: "❌" }[state]);
      if (state !== "seen") recent.delete(message.id);
    },

    // Text channels in the servers the bot is in, for the dashboard's channel picker.
    async channels() {
      return [...client.channels.cache.values()]
        .filter((channel) => channel.type === ChannelType.GuildText)
        .slice(0, 1000)
        .map((channel) => ({
          id: channel.id,
          name: `${channel.guild.name} / #${channel.name}`,
        }));
    },
  };
}

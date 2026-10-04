import type {
  ChatAdapter,
  ChatEvents,
  ChatFile,
  ChatPrompt,
  ChatThread,
  ChatUser,
  HistoryMessage,
} from "@gitterm/bot";
import {
  App,
  LogLevel,
  type BlockAction,
  type BlockButtonAction,
  type BlockCheckboxesAction,
} from "@slack/bolt";
import {
  ACTION,
  answerMessages,
  CUSTOM_INPUT,
  CUSTOM_MODAL,
  customAnswerView,
  promptAttachment,
  promptIdOf,
  settledAttachment,
} from "./blocks.js";

export type SlackAdapterOptions = {
  /** Bot token (`xoxb-…`). Defaults to `SLACK_BOT_TOKEN`. */
  botToken?: string;
  /** App-level token with `connections:write` (`xapp-…`) for Socket Mode. Defaults to `SLACK_APP_TOKEN`. */
  appToken?: string;
};

/** The part of a Slack message the bot reads, from events and `conversations.replies`. */
type SlackMessage = {
  ts?: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFile[];
};
type SlackFile = {
  id: string;
  name?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
};

const HISTORY_LIMIT = 200;

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

/**
 * Slack over Socket Mode: no public URL needed. The bot answers mentions in channels it was
 * invited to; every thread is one agent session.
 */
export function createSlackAdapter(options: SlackAdapterOptions = {}): ChatAdapter {
  const botToken = required(options.botToken ?? process.env.SLACK_BOT_TOKEN, "SLACK_BOT_TOKEN");
  const appToken = required(options.appToken ?? process.env.SLACK_APP_TOKEN, "SLACK_APP_TOKEN");
  const app = new App({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.WARN });
  const client = app.client;
  const names = new Map<string, string>();
  /** Ticked checkboxes of open multi-select questions, submitted with the Submit button. */
  const ticked = new Map<string, number[]>();
  /** Cleared once Slack refuses the native status indicator; status messages are used instead. */
  let indicatorAvailable = true;
  let teamId = "";
  let botUserId = "";

  const stripMention = (text: string) => text.replaceAll(`<@${botUserId}>`, "").trim();

  const user = async (id: string | undefined): Promise<ChatUser> => {
    if (!id) return { id: "unknown", name: "someone" };
    let name = names.get(id);
    if (!name) {
      name = await client.users
        .info({ user: id })
        .then(
          (result) =>
            result.user?.profile?.display_name || result.user?.real_name || result.user?.name || id,
        )
        .catch(() => id);
      names.set(id, name);
    }
    return { id, name };
  };

  const file = (entry: SlackFile): ChatFile => ({
    id: entry.id,
    name: entry.name ?? entry.id,
    mime: entry.mimetype ?? "application/octet-stream",
    size: entry.size ?? 0,
    async download() {
      const response = await fetch(entry.url_private_download ?? "", {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      // Without files:read Slack answers with its HTML login page instead of an error.
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) {
        throw new Error(
          `Could not download “${entry.name ?? entry.id}” from Slack (HTTP ${response.status}); the app needs the files:read scope`,
        );
      }
      return Buffer.from(await response.arrayBuffer()).toString("base64");
    },
  });

  const fromBot = (message: SlackMessage) =>
    Boolean(message.bot_id) || message.subtype === "bot_message" || message.user === botUserId;

  return {
    platform: "slack",
    displayName: "Slack",

    async start(events: ChatEvents) {
      const sameTeam = (id: string | undefined) => !id || id === teamId;

      app.event("app_mention", async ({ event, context }) => {
        if (!sameTeam(context.teamId) || event.bot_id || !event.user) return;
        events.message({
          id: event.ts,
          thread: { channel: event.channel, thread: event.thread_ts ?? event.ts },
          author: await user(event.user),
          text: stripMention(event.text),
          files: ((event as { files?: SlackFile[] }).files ?? []).map(file),
          mentioned: true,
          inThread: Boolean(event.thread_ts),
        });
      });

      // Plain thread replies only matter as answers to an open question; mentions arrive
      // through app_mention above.
      app.message(async ({ message, context }) => {
        const reply = message as SlackMessage & { channel: string };
        if (!sameTeam(context.teamId) || fromBot(reply) || !reply.user || !reply.ts) return;
        if (reply.subtype && reply.subtype !== "file_share") return;
        if (!reply.thread_ts || reply.thread_ts === reply.ts) return;
        if (reply.text?.includes(`<@${botUserId}>`)) return;
        events.message({
          id: reply.ts,
          thread: { channel: reply.channel, thread: reply.thread_ts },
          author: await user(reply.user),
          text: reply.text?.trim() ?? "",
          files: (reply.files ?? []).map(file),
          mentioned: false,
          inThread: true,
        });
      });

      const answer = (
        body: BlockAction,
        promptId: string | null,
        value: Parameters<ChatEvents["answer"]>[1],
      ) =>
        promptId !== null &&
        sameTeam(body.team?.id) &&
        events.answer(promptId, value, { id: body.user.id, name: body.user.name ?? body.user.id });
      const stale = {
        response_type: "ephemeral" as const,
        replace_original: false,
        text: "This was already answered.",
      };

      app.action<BlockButtonAction>(ACTION.option, async ({ ack, body, action, respond }) => {
        await ack();
        const promptId = promptIdOf(action.block_id);
        const prompt = promptId ? events.prompt(promptId) : undefined;
        const label =
          prompt?.kind === "question"
            ? prompt.question.options[Number(action.value)]?.label
            : undefined;
        if (!label || !answer(body, promptId, { kind: "question", labels: [label] }))
          await respond(stale);
      });

      app.action<BlockCheckboxesAction>(ACTION.toggle, async ({ ack, action }) => {
        await ack();
        const promptId = promptIdOf(action.block_id);
        if (promptId)
          ticked.set(
            promptId,
            action.selected_options.map((option) => Number(option.value)),
          );
      });

      app.action<BlockButtonAction>(ACTION.submit, async ({ ack, body, action, respond }) => {
        await ack();
        const promptId = promptIdOf(action.block_id);
        const prompt = promptId ? events.prompt(promptId) : undefined;
        if (prompt?.kind !== "question" || !promptId) {
          await respond(stale);
          return;
        }
        const labels = (ticked.get(promptId) ?? [])
          .map((index) => prompt.question.options[index]?.label)
          .filter((label): label is string => Boolean(label));
        if (labels.length === 0) {
          await respond({ ...stale, text: "Tick at least one option before pressing Submit." });
          return;
        }
        if (!answer(body, promptId, { kind: "question", labels })) await respond(stale);
      });

      app.action<BlockButtonAction>(ACTION.permission, async ({ ack, body, action, respond }) => {
        await ack();
        const response = action.value as "once" | "always" | "reject";
        if (!answer(body, promptIdOf(action.block_id), { kind: "permission", response }))
          await respond(stale);
      });

      app.action<BlockButtonAction>(
        ACTION.custom,
        async ({ ack, body, action, client: web, respond }) => {
          await ack();
          const promptId = promptIdOf(action.block_id);
          const prompt = promptId ? events.prompt(promptId) : undefined;
          if (prompt?.kind !== "question") {
            await respond(stale);
            return;
          }
          await web.views.open({ trigger_id: body.trigger_id, view: customAnswerView(prompt) });
        },
      );

      app.view(CUSTOM_MODAL, async ({ ack, body, view }) => {
        const promptId = view.private_metadata;
        const prompt = events.prompt(promptId);
        const text = view.state.values.answer?.[CUSTOM_INPUT]?.value?.trim() ?? "";
        // A free-text answer joins whatever is ticked in a multi-select question.
        const labels =
          prompt?.kind === "question" && prompt.question.multiple
            ? (ticked.get(promptId) ?? []).map(
                (index) => prompt.question.options[index]?.label ?? "",
              )
            : [];
        const answered =
          text &&
          sameTeam(body.team?.id) &&
          events.answer(
            promptId,
            { kind: "question", labels: [...new Set([...labels.filter(Boolean), text])] },
            {
              id: body.user.id,
              name: body.user.name,
            },
          );
        if (answered) return ack();
        await ack({
          response_action: "errors",
          errors: {
            answer: text ? "This question was already answered." : "Write an answer first.",
          },
        });
      });

      app.error(async (error) => {
        console.error("Slack error", error);
      });

      await app.start();
      const identity = await client.auth.test();
      teamId = identity.team_id ?? "";
      botUserId = identity.user_id ?? "";
      return { scope: teamId };
    },

    async stop() {
      await app.stop();
    },

    async history(thread, after) {
      const replies = await client.conversations.replies({
        channel: thread.channel,
        ts: thread.thread,
        limit: HISTORY_LIMIT,
      });
      const messages = (replies.messages ?? []) as SlackMessage[];
      const result: HistoryMessage[] = [];
      for (const message of messages) {
        if (!message.ts || (after && Number(message.ts) <= Number(after))) continue;
        const bot = fromBot(message);
        result.push({
          id: message.ts,
          author: bot ? { id: message.user ?? "bot", name: "assistant" } : await user(message.user),
          fromBot: bot,
          text: stripMention(message.text ?? ""),
          files: (message.files ?? []).map(file),
        });
      }
      return result;
    },

    async post(thread, text) {
      const posted = await client.chat.postMessage({
        channel: thread.channel,
        thread_ts: thread.thread,
        text,
      });
      if (!posted.ts) throw new Error("Slack did not return a message timestamp");
      return posted.ts;
    },

    async edit(thread, messageId, text) {
      await client.chat.update({ channel: thread.channel, ts: messageId, text });
    },

    async remove(thread, messageId) {
      await client.chat.delete({ channel: thread.channel, ts: messageId });
    },

    async reply(thread, markdown, footer) {
      for (const message of answerMessages(markdown, footer)) {
        await client.chat.postMessage({
          channel: thread.channel,
          thread_ts: thread.thread,
          ...message,
        });
      }
    },

    async ask(thread: ChatThread, prompt: ChatPrompt) {
      // No top-level text: Slack would show it above the coloured card. The fallback is what
      // notifications show.
      const posted = await client.chat.postMessage({
        channel: thread.channel,
        thread_ts: thread.thread,
        attachments: [promptAttachment(prompt)],
      });
      if (!posted.ts) throw new Error("Slack did not return a message timestamp");
      return posted.ts;
    },

    async settle(thread, messageId, prompt, outcome) {
      ticked.delete(prompt.id);
      await client.chat.update({
        channel: thread.channel,
        ts: messageId,
        text: "",
        attachments: [settledAttachment(prompt, outcome)],
      });
    },

    // "Acme Agent is working on it…" under the thread, like Slack's own AI apps. Channel apps
    // only need chat:write for it.
    async indicate(thread, status) {
      if (!indicatorAvailable) return false;
      try {
        await client.assistant.threads.setStatus({
          channel_id: thread.channel,
          thread_ts: thread.thread,
          status,
        });
        return true;
      } catch (error) {
        // Slack said no (scope, plan, policy): stop asking. A network error only skips this call.
        if ((error as { code?: string }).code === "slack_webapi_platform_error") {
          indicatorAvailable = false;
          console.warn(
            "Slack refused the native status indicator; using status messages instead",
            error,
          );
        }
        return false;
      }
    },

    async acknowledge(message) {
      await client.reactions.add({
        channel: message.thread.channel,
        timestamp: message.id,
        name: "eyes",
      });
    },
  };
}

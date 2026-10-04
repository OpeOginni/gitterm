import { createBot, type Bot, type BotOptions } from "@gitterm/bot";
import { createSlackAdapter, type SlackAdapterOptions } from "./adapter.js";

export { createSlackAdapter, type SlackAdapterOptions } from "./adapter.js";
export { slackManifest } from "./manifest.js";
export type { Bot, RepoTarget, WorkspaceOverrides } from "@gitterm/bot";

export type SlackBotOptions = Omit<BotOptions, "adapter"> & SlackAdapterOptions;

/**
 * A Slack bot that runs a coding agent on your repository in a GitTerm sandbox.
 *
 * ```ts
 * await createSlackBot({ repo: "https://github.com/acme/app" }).start();
 * ```
 *
 * Tokens default to `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `GITTERM_API_TOKEN`; pass `app` to
 * add the agent to a Bolt app you already run.
 */
export function createSlackBot(options: SlackBotOptions): Bot {
  const { botToken, appToken, app, ...bot } = options;
  return createBot({
    ...bot,
    adapter: createSlackAdapter({
      ...(botToken ? { botToken } : {}),
      ...(appToken ? { appToken } : {}),
      ...(app ? { app } : {}),
    }),
  });
}

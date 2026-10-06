import { createBot, type Bot, type BotOptions } from "@gitterm/bot";
import { createDiscordAdapter, type DiscordAdapterOptions } from "./adapter.js";

export { createDiscordAdapter, type DiscordAdapterOptions } from "./adapter.js";
export type { Bot, RepoTarget, WorkspaceOverrides } from "@gitterm/bot";

export type DiscordBotOptions = Omit<BotOptions, "adapter"> & DiscordAdapterOptions;

/**
 * A Discord bot that runs a coding agent on your repository in a GitTerm sandbox.
 *
 * ```ts
 * await createDiscordBot({ repo: "https://github.com/acme/app" }).start();
 * ```
 *
 * Tokens default to `DISCORD_BOT_TOKEN` and `GITTERM_API_TOKEN`; pass `client` to add the agent
 * to a discord.js client you already run.
 */
export function createDiscordBot(options: DiscordBotOptions): Bot {
  const { token, client, ...bot } = options;
  return createBot({
    ...bot,
    adapter: createDiscordAdapter({ ...(token ? { token } : {}), ...(client ? { client } : {}) }),
  });
}

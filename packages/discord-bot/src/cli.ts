#!/usr/bin/env node
import { BOT_ENV_HELP, cliOptions, hasRepository } from "@gitterm/bot";
import { createDiscordBot, withSavedConfig } from "./index.js";

const USAGE = `Usage: gitterm-discord-bot [-h] [--repo <url>[#branch]] [--model <provider/model>]
                    [--instructions-file <path>]

Environment (a .env file in the working directory is loaded):
  DISCORD_BOT_TOKEN               Bot token; enable the Message Content intent
${BOT_ENV_HELP}

The invite link for your server is printed when the bot starts.`;

const { command, options: local } = cliOptions();
if (command === "help" || (!hasRepository(local) && !process.env.GITTERM_API_TOKEN)) {
  console.log(USAGE);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  // Settings saved in the dashboard fill in whatever the environment and flags leave out.
  const options = await withSavedConfig(local);
  if (!hasRepository(options)) {
    console.log(USAGE);
    console.error("\nNo repository: set GITTERM_BOT_REPO, or save this bot under Bots in GitTerm.");
    process.exit(1);
  }
  const bot = createDiscordBot(options);
  await bot.start();
  const shutdown = () => void bot.stop().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

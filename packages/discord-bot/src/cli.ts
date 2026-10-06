#!/usr/bin/env node
import { BOT_ENV_HELP, cliOptions, hasRepository } from "@gitterm/bot";
import { createDiscordBot } from "./index.js";

const USAGE = `Usage: gitterm-discord-bot [--repo <url>[#branch]] [--model <provider/model>]
                    [--instructions-file <path>]

Environment (a .env file in the working directory is loaded):
  DISCORD_BOT_TOKEN               Bot token; enable the Message Content intent
${BOT_ENV_HELP}

The invite link for your server is printed when the bot starts.`;

const { command, options } = cliOptions();
if (command === "help" || !hasRepository(options)) {
  console.log(USAGE);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  const bot = createDiscordBot(options);
  await bot.start();
  const shutdown = () => void bot.stop().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

#!/usr/bin/env node
import { cliOptions } from "@gitterm/bot";
import { createDiscordBot } from "./index.js";

const USAGE = `Usage: gitterm-discord-bot [--repo <url>[#branch]] [--model <provider/model>]
                    [--instructions-file <path>]

Environment (a .env file in the working directory is loaded):
  DISCORD_BOT_TOKEN     Bot token; enable the Message Content intent for the bot
  GITTERM_API_TOKEN     GitTerm API token (or run \`gitterm login\`)
  GITTERM_SERVER_URL    Self-hosted GitTerm API URL (default: hosted)
  GITTERM_BOT_REPO      Repository for every channel, e.g. https://github.com/acme/app#main
  GITTERM_BOT_CHANNELS  Per-channel repositories: 1234567890=https://github.com/acme/api,…
  GITTERM_BOT_MODEL, GITTERM_BOT_PROVIDER, GITTERM_BOT_CONNECTIONS (auto | none | id,…),
  GITTERM_BOT_INSTRUCTIONS, GITTERM_BOT_INSTRUCTIONS_FILE, GITTERM_BOT_STATE_FILE,
  GITTERM_BOT_RUN_TIMEOUT_MINUTES

The invite link for your server is printed when the bot starts.`;

const { command, options } = cliOptions();
if (command === "help" || (!options.repo && !options.channels)) {
  console.log(USAGE);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  const bot = createDiscordBot(options);
  await bot.start();
  const shutdown = () => void bot.stop().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

#!/usr/bin/env node
import { BOT_ENV_HELP, cliOptions, hasRepository } from "@gitterm/bot";
import { createSlackBot } from "./index.js";
import { slackManifest } from "./manifest.js";

const USAGE = `Usage: gitterm-slack-bot [--repo <url>[#branch]] [--model <provider/model>]
                    [--instructions-file <path>]
       gitterm-slack-bot manifest [name]

Environment (a .env file in the working directory is loaded):
  SLACK_BOT_TOKEN                 Bot token (xoxb-…)
  SLACK_APP_TOKEN                 App-level token with connections:write (xapp-…)
${BOT_ENV_HELP}`;

const { command, options } = cliOptions();
if (command === "manifest") {
  console.log(JSON.stringify(slackManifest(process.argv[3]), null, 2));
} else if (command === "help" || !hasRepository(options)) {
  console.log(USAGE);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  const bot = createSlackBot(options);
  await bot.start();
  const shutdown = () => void bot.stop().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

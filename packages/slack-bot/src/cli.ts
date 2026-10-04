#!/usr/bin/env node
import { cliOptions } from "@gitterm/bot";
import { createSlackBot } from "./index.js";
import { slackManifest } from "./manifest.js";

const USAGE = `Usage: gitterm-slack-bot [--repo <url>[#branch]] [--model <provider/model>]
                    [--instructions-file <path>]
       gitterm-slack-bot manifest [name]

Environment (a .env file in the working directory is loaded):
  SLACK_BOT_TOKEN       Bot token (xoxb-…)
  SLACK_APP_TOKEN       App-level token with connections:write (xapp-…)
  GITTERM_API_TOKEN     GitTerm API token (or run \`gitterm login\`)
  GITTERM_SERVER_URL    Self-hosted GitTerm API URL (default: hosted)
  GITTERM_BOT_REPO      Repository for every channel, e.g. https://github.com/acme/app#main
  GITTERM_BOT_CHANNELS  Per-channel repositories: C0123=https://github.com/acme/api,…
  GITTERM_BOT_MODEL (+ GITTERM_BOT_MODEL_CREDENTIAL or GITTERM_BOT_MODEL_API_KEY),
  GITTERM_BOT_PROVIDER, GITTERM_BOT_CONNECTIONS (auto | none | id,…),
  GITTERM_BOT_INSTRUCTIONS, GITTERM_BOT_INSTRUCTIONS_FILE, GITTERM_BOT_STATE_FILE,
  GITTERM_BOT_RUN_TIMEOUT_MINUTES`;

const { command, options } = cliOptions();
if (command === "manifest") {
  console.log(JSON.stringify(slackManifest(process.argv[3]), null, 2));
} else if (command === "help" || (!options.repo && !options.channels)) {
  console.log(USAGE);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  const bot = createSlackBot(options);
  await bot.start();
  const shutdown = () => void bot.stop().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

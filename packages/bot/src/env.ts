import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import type { WorkspaceProviderSelection } from "@gitterm/sdk";
import type { BotOptions, RepoTarget } from "./types.js";

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string) => env[name]?.trim() || undefined;

function positive(env: Env, name: string): number | undefined {
  const value = read(env, name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

/** `C123=https://github.com/acme/api,C456=https://github.com/acme/web#develop` */
function parseChannels(value: string): Record<string, RepoTarget> {
  const channels: Record<string, RepoTarget> = {};
  for (const entry of value.split(",")) {
    const [channel, repo] = entry.split("=", 2).map((part) => part.trim());
    if (!channel || !repo) {
      throw new Error(`GITTERM_BOT_CHANNELS entries look like <channel id>=<repository url>`);
    }
    channels[channel] = repo;
  }
  return channels;
}

/**
 * Bot settings from the environment, shared by the Slack and Discord command lines. GitTerm
 * credentials are read by the SDK itself (`GITTERM_API_TOKEN`, `GITTERM_SERVER_URL`, or the
 * `gitterm login` config).
 */
export function botOptionsFromEnv(env: Env = process.env): Omit<BotOptions, "adapter"> {
  const connections = read(env, "GITTERM_BOT_CONNECTIONS");
  const provider = read(env, "GITTERM_BOT_PROVIDER");
  const channels = read(env, "GITTERM_BOT_CHANNELS");
  const options: Omit<BotOptions, "adapter"> = {};
  const repo = read(env, "GITTERM_BOT_REPO");
  if (repo) options.repo = repo;
  if (channels) options.channels = parseChannels(channels);
  if (connections && connections !== "auto") {
    options.connections =
      connections === "none" ? [] : connections.split(",").map((value) => value.trim());
  }
  const model = read(env, "GITTERM_BOT_MODEL");
  if (model) options.model = model;
  const instructions = read(env, "GITTERM_BOT_INSTRUCTIONS");
  if (instructions) options.instructions = instructions;
  if (provider) options.workspace = { provider: { type: provider } as WorkspaceProviderSelection };
  const stateFile = read(env, "GITTERM_BOT_STATE_FILE");
  if (stateFile) options.stateFile = stateFile;
  const runTimeoutMinutes = positive(env, "GITTERM_BOT_RUN_TIMEOUT_MINUTES");
  if (runTimeoutMinutes) options.runTimeoutMs = runTimeoutMinutes * 60_000;
  return options;
}

/**
 * The shared command-line entry: loads `.env` from the working directory, applies `--repo`,
 * and returns the bot options.
 */
export function cliOptions(argv: string[] = process.argv.slice(2)): {
  command: string | undefined;
  options: Omit<BotOptions, "adapter">;
} {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { repo: { type: "string" }, model: { type: "string" } },
  });
  const options = botOptionsFromEnv();
  if (values.repo) options.repo = values.repo;
  if (values.model) options.model = values.model;
  return { command: positionals[0], options };
}

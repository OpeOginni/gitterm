import { existsSync, readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
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

const list = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/** A dotenv file whose variables go into new sandboxes, e.g. test credentials. */
function readSandboxEnv(path: string | undefined): Record<string, string> | undefined {
  if (!path) return undefined;
  try {
    const parsed = parseEnv(readFileSync(path, "utf8")) as Record<string, string | undefined>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  } catch (error) {
    throw new Error(`Could not read the sandbox environment file ${path}`, { cause: error });
  }
}

function readInstructionsFile(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch (error) {
    throw new Error(`Could not read the instructions file ${path}`, { cause: error });
  }
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
  if (connections) options.connections = list(connections);
  const repos = read(env, "GITTERM_BOT_REPOS");
  if (repos) options.repos = list(repos);
  const allowedUsers = read(env, "GITTERM_BOT_ALLOWED_USERS");
  if (allowedUsers) options.allowedUsers = list(allowedUsers);
  if (read(env, "GITTERM_BOT_ALLOW_GUESTS") === "true") options.allowGuests = true;
  const setup = read(env, "GITTERM_BOT_SETUP");
  if (setup) options.setup = [setup];
  const sandboxEnv = readSandboxEnv(read(env, "GITTERM_BOT_SANDBOX_ENV_FILE"));
  if (sandboxEnv) options.env = sandboxEnv;
  const model = read(env, "GITTERM_BOT_MODEL");
  const credential = read(env, "GITTERM_BOT_MODEL_CREDENTIAL");
  const apiKey = read(env, "GITTERM_BOT_MODEL_API_KEY");
  if ((credential || apiKey) && !model) {
    throw new Error(
      "GITTERM_BOT_MODEL_CREDENTIAL and GITTERM_BOT_MODEL_API_KEY need GITTERM_BOT_MODEL",
    );
  }
  if (model) {
    options.model = {
      id: model,
      ...(credential ? { credential } : {}),
      ...(apiKey ? { apiKey } : {}),
    };
  }
  const instructions = [
    read(env, "GITTERM_BOT_INSTRUCTIONS"),
    readInstructionsFile(read(env, "GITTERM_BOT_INSTRUCTIONS_FILE")),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (instructions) options.instructions = instructions;
  const githubToken = read(env, "GITTERM_BOT_GITHUB_TOKEN");
  if (provider || githubToken) {
    options.workspace = {
      ...(provider ? { provider: { type: provider } as WorkspaceProviderSelection } : {}),
      ...(githubToken ? { repositoryCredentials: { token: githubToken } } : {}),
    };
  }
  const stateFile = read(env, "GITTERM_BOT_STATE_FILE");
  if (stateFile) options.stateFile = stateFile;
  const runTimeoutMinutes = positive(env, "GITTERM_BOT_RUN_TIMEOUT_MINUTES");
  if (runTimeoutMinutes) options.runTimeoutMs = runTimeoutMinutes * 60_000;
  return options;
}

/**
 * The shared command-line entry: loads `.env` from the working directory and returns the bot
 * options. `--repo`, `--model`, and `--instructions-file` override their environment variables.
 */
export function cliOptions(argv: string[] = process.argv.slice(2)): {
  command: string | undefined;
  options: Omit<BotOptions, "adapter">;
} {
  // Bun loads .env itself and has no process.loadEnvFile; Node needs the call.
  if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      model: { type: "string" },
      "instructions-file": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const flags: Env = {
    GITTERM_BOT_REPO: values.repo,
    GITTERM_BOT_MODEL: values.model,
    GITTERM_BOT_INSTRUCTIONS_FILE: values["instructions-file"],
  };
  const env = { ...process.env };
  for (const [name, value] of Object.entries(flags)) if (value) env[name] = value;
  return { command: values.help ? "help" : positionals[0], options: botOptionsFromEnv(env) };
}

/** The environment variables every bot command line reads, for its usage text. */
export const BOT_ENV_HELP = `  Settings saved for this bot under Bots in GitTerm load at startup; these override them.

  GITTERM_API_TOKEN               The bot's GitTerm token (dashboard → Bots creates one)
  GITTERM_SERVER_URL              Self-hosted GitTerm API URL (default: hosted)
  GITTERM_BOT_REPO                Repository for every channel: https://github.com/acme/app[#branch]
  GITTERM_BOT_REPOS               More repositories people can name in a thread: url,url
  GITTERM_BOT_CHANNELS            Per-channel repositories: <channel id>=<url>,…
  GITTERM_BOT_MODEL               provider/model, e.g. anthropic/claude-sonnet-5-5
  GITTERM_BOT_MODEL_CREDENTIAL    Saved credential label (default: the provider's default)
  GITTERM_BOT_MODEL_API_KEY       Or a model API key for this bot only
  GITTERM_BOT_GITHUB_TOKEN        Your own GitHub token instead of a GitTerm GitHub connection
  GITTERM_BOT_CONNECTIONS         Tools besides GitHub, by name: Linear,Sentry
  GITTERM_BOT_ALLOWED_USERS       Only these user ids may use the bot: U012,U034
  GITTERM_BOT_ALLOW_GUESTS        true lets guests and external people use the bot
  GITTERM_BOT_INSTRUCTIONS[_FILE] What the agent should know and how to behave
  GITTERM_BOT_SETUP               Command run before the agent starts, e.g. "pnpm install"
  GITTERM_BOT_SANDBOX_ENV_FILE    dotenv file of variables for the sandbox (test credentials)
  GITTERM_BOT_PROVIDER            Compute provider for new sandboxes (railway, e2b, …)
  GITTERM_BOT_STATE_FILE, GITTERM_BOT_RUN_TIMEOUT_MINUTES`;

/** Whether the options name at least one repository the bot can work on. */
export const hasRepository = (options: Omit<BotOptions, "adapter">) =>
  Boolean(options.repo || options.repos?.length || Object.keys(options.channels ?? {}).length);

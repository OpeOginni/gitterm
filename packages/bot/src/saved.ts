import {
  createGittermClient,
  type GittermClient,
  type SavedBot,
  type WorkspaceProviderSelection,
} from "@gitterm/sdk";
import { hasRepository } from "./env.js";
import type { BotLogger, BotOptions } from "./types.js";

type Options = Omit<BotOptions, "adapter">;

const isClient = (value: Options["gitterm"]): value is GittermClient =>
  typeof value === "object" && value !== null && "runs" in value;

/**
 * Adds the settings saved for this bot in the GitTerm dashboard (Bots), found by its API token.
 * Anything already set in `options` (code, environment, or flags) wins. Without saved settings,
 * for example a token that isn't a bot's, the options come back unchanged.
 */
export async function withSavedConfig(
  options: Options,
  platform: SavedBot["platform"],
  log: BotLogger = console,
): Promise<Options> {
  const gitterm = isClient(options.gitterm)
    ? options.gitterm
    : createGittermClient(options.gitterm);
  const base: Options = { ...options, gitterm };
  const saved = await gitterm.bots.self().catch((error: unknown) => {
    log.warn("Could not load the bot's saved settings from GitTerm", error);
    return null;
  });
  if (!saved) return base;
  if (saved.platform !== platform) {
    throw new Error(
      `This GitTerm token belongs to the ${saved.platform} bot "${saved.name}"; run that bot with it`,
    );
  }

  const merged: Options = { ...base };
  if (!hasRepository(options)) {
    // Picked channels answer only there; otherwise every channel the bot is in.
    if (saved.channels.length) {
      merged.channels = Object.fromEntries(saved.channels.map((id) => [id, saved.repo]));
    } else {
      merged.repo = saved.repo;
    }
  }
  merged.model ??= {
    id: saved.model,
    ...(saved.credential ? { credential: saved.credential } : {}),
  };
  merged.connections ??= saved.connections;
  if (saved.provider && !options.workspace?.provider) {
    merged.workspace = {
      ...options.workspace,
      provider: { type: saved.provider } as WorkspaceProviderSelection,
    };
  }
  if (saved.allowedUsers.length) merged.allowedUsers ??= saved.allowedUsers;
  merged.allowGuests ??= saved.allowGuests;
  if (saved.instructions) merged.instructions ??= saved.instructions;
  if (saved.setup) merged.setup ??= [saved.setup];
  if (saved.githubAccess === "token" && !merged.workspace?.repositoryCredentials) {
    log.warn(
      `"${saved.name}" uses your own GitHub token, but GITTERM_BOT_GITHUB_TOKEN is not set. Public repositories still work.`,
    );
  }
  log.info(`Using the settings saved for "${saved.name}" in GitTerm.`);
  return merged;
}

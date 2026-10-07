import {
  createGittermClient,
  type GittermClient,
  type SavedBot,
  type WorkspaceProviderSelection,
} from "@gitterm/sdk";
import { hasRepository } from "./env.js";
import type { BotLogger, BotOptions } from "./types.js";
import { parseRepo, repoKey } from "./workspaces.js";

type Options = Omit<BotOptions, "adapter">;

const isClient = (value: Options["gitterm"]): value is GittermClient =>
  typeof value === "object" && value !== null && "runs" in value;

/**
 * Adds the settings saved for this bot in the GitTerm dashboard (Bots), found by its API token.
 * Routing can be overridden locally; saved authorization is an upper bound. Without saved settings,
 * for example a token that isn't a bot's, the options come back unchanged. The options given are
 * kept as `localOptions`, so the running bot can apply settings saved later the same way.
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
  // A failed request is not evidence of an ordinary account token. Never discard saved policy.
  const saved = await gitterm.bots.self();
  if (!saved) return base;
  if (saved.platform !== platform) {
    throw new Error(
      `This GitTerm token belongs to the ${saved.platform} bot "${saved.name}"; run that bot with it`,
    );
  }
  log.info(`Using the settings saved for "${saved.name}" in GitTerm.`);
  return { ...applySavedConfig(base, saved, log), localOptions: base };
}

/** Saved settings on top of local options; throws when the local options exceed them. */
export function applySavedConfig(
  options: Options,
  saved: SavedBot,
  log: BotLogger = console,
): Options {
  const merged: Options = { ...options };
  const localRepos = [
    options.repo,
    ...(options.repos ?? []),
    ...Object.values(options.channels ?? {}),
  ].filter((repo) => repo !== undefined);
  if (localRepos.some((repo) => repoKey(parseRepo(repo)) !== repoKey(parseRepo(saved.repo)))) {
    throw new Error(
      "Local repository routing exceeds the saved bot policy. Change its repository in GitTerm first.",
    );
  }
  const localModel = typeof options.model === "string" ? options.model : options.model?.id;
  if (localModel && localModel !== saved.model)
    throw new Error("Local model exceeds the saved bot policy. Change its model in GitTerm first.");
  if (options.connections?.some((reference) => !saved.connections.includes(reference))) {
    throw new Error("Local connections exceed the saved bot policy. Select them in GitTerm first.");
  }
  merged.botId = saved.id;
  if (saved.channels.length) {
    merged.allowedChannels = options.allowedChannels
      ? options.allowedChannels.filter((id) => saved.channels.includes(id))
      : saved.channels;
  }
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
  if (saved.allowedUsers.length) {
    merged.allowedUsers = options.allowedUsers
      ? options.allowedUsers.filter((id) => saved.allowedUsers.includes(id))
      : saved.allowedUsers;
  }
  merged.allowGuests = saved.allowGuests && (options.allowGuests ?? true);
  if (saved.instructions) merged.instructions ??= saved.instructions;
  if (saved.setup) merged.setup ??= [saved.setup];
  if (saved.githubAccess === "token" && !merged.workspace?.repositoryCredentials) {
    log.warn(
      `"${saved.name}" uses your own GitHub token, but GITTERM_BOT_GITHUB_TOKEN is not set. Public repositories still work.`,
    );
  }
  log.info("Effective bot authorization", {
    botId: saved.id,
    source: "saved policy, intersected with local restrictions",
    channels: merged.allowedChannels ?? "all invited channels",
    users: merged.allowedUsers ?? "channel members",
    allowGuests: merged.allowGuests,
  });
  return merged;
}

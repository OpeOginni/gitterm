import { z } from "zod";
import type { ApiTokenScope } from "./api-token";

/** Exactly what a chat bot needs: find and create its sandboxes, run prompts, list connections. */
export const BOT_TOKEN_SCOPES: ApiTokenScope[] = [
  "identity:read",
  "workspace:read",
  "workspace:write",
  "run:read",
  "run:write",
  "integrations:read",
];

/** A chat bot's saved settings: everything but its secrets, which stay in the bot's .env. */
export const botSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  platform: z.enum(["slack", "discord"]),
  /** Repository URL, with `#branch` when one is picked. */
  repo: z.string().trim().min(1).max(500),
  /** OpenCode `provider/model`. */
  model: z.string().trim().min(3).max(200),
  /** Saved credential label; null uses the provider's default credential. */
  credential: z.string().trim().min(1).max(100).nullable(),
  /** Tool connection references besides GitHub. */
  connections: z.array(z.string().trim().min(1).max(200)).max(50),
  /** Compute provider key; null uses the owner's default. */
  provider: z.string().trim().min(1).max(50).nullable(),
  /** "token" means the bot brings its own GITTERM_BOT_GITHUB_TOKEN. */
  githubAccess: z.enum(["connection", "token"]),
  /** Channel ids it answers in; empty answers in every channel it's in. */
  channels: z.array(z.string().trim().min(1).max(100)).max(200),
  /** User ids allowed to use it; empty allows everyone in the channel. */
  allowedUsers: z.array(z.string().trim().min(1).max(100)).max(500),
  /** Slack guests and people from other organisations in shared channels. */
  allowGuests: z.boolean(),
  /** What the agent should know and how to behave. */
  instructions: z.string().trim().max(20_000).nullable(),
  /** A command run in the checkout before the agent starts in a new sandbox. */
  setup: z.string().trim().max(2_000).nullable(),
});

export type BotSettings = z.infer<typeof botSettingsSchema>;

/** A channel a running bot reported it's in. */
export const botChannelSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
});

export type BotChannel = z.infer<typeof botChannelSchema>;

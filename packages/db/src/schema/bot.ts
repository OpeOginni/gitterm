import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apiToken, user } from "./auth";

/**
 * A chat bot's saved settings. The bot reads them with its API token at startup, so the bot's
 * .env holds only secrets. No secret is stored here: the GitTerm token is shown once, and the
 * Slack, Discord, and personal GitHub tokens never leave the bot's .env.
 */
export const bot = pgTable(
  "bot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "slack" | "discord" */
    platform: text("platform").notNull(),
    /** Repository URL, with `#branch` when one is picked. */
    repo: text("repo").notNull(),
    /** OpenCode `provider/model`. */
    model: text("model").notNull(),
    /** Saved credential label; null uses the provider's default credential. */
    credential: text("credential"),
    /** Tool connection references besides GitHub. */
    connections: text("connections").array().notNull().default([]),
    /** Compute provider key; null uses the owner's default. */
    provider: text("provider"),
    /** "connection" | "token" (the bot's own GITTERM_BOT_GITHUB_TOKEN) */
    githubAccess: text("github_access").notNull().default("connection"),
    /** Channel ids it answers in; empty answers in every channel it's in. */
    channels: text("channels").array().notNull().default([]),
    /** User ids allowed to use it; empty allows everyone in the channel. */
    allowedUsers: text("allowed_users").array().notNull().default([]),
    /** Slack guests and people from other organisations in shared channels. */
    allowGuests: boolean("allow_guests").notNull().default(false),
    /** What the agent should know and how to behave. */
    instructions: text("instructions"),
    /** A command run in the checkout before the agent starts in a new sandbox. */
    setup: text("setup"),
    /** Channels the bot reported it's in, so the dashboard can offer them; not user-edited. */
    knownChannels: jsonb("known_channels").$type<Array<{ id: string; name: string }>>(),
    /** The token the bot runs with; it identifies the bot when it asks for its settings. */
    apiTokenId: uuid("api_token_id")
      .unique()
      .references(() => apiToken.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("bot_user_idx").on(table.userId)],
);

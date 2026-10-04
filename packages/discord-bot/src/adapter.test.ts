import { describe, expect, test } from "bun:test";
import { Client, GatewayIntentBits } from "discord.js";
import { createDiscordAdapter } from "./adapter.js";

describe("createDiscordAdapter", () => {
  test("accepts your own client when it has the intents the bot needs", () => {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    expect(createDiscordAdapter({ client }).platform).toBe("discord");
  });

  test("names the intents a supplied client is missing", () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    expect(() => createDiscordAdapter({ client })).toThrow("GuildMessages, MessageContent");
  });
});

import { expect, spyOn, test } from "bun:test";
import type { ChatMessage } from "@gitterm/bot";
import { type App, webApi } from "@slack/bolt";
import { createSlackAdapter } from "./adapter.js";
import { slackManifest } from "./manifest.js";

test("Slack's native Stop uses the engine's authorized stop-command path", async () => {
  const listeners = new Map<string, (args: unknown) => Promise<void>>();
  const app = {
    event(name: string, listener: (args: unknown) => Promise<void>) {
      listeners.set(name, listener);
    },
    message() {},
    action() {},
    view() {},
  } as unknown as App;
  const messages: ChatMessage[] = [];
  const api = spyOn(webApi.WebClient.prototype, "apiCall").mockImplementation(async (method) => {
    if (method === "auth.test") return { ok: true, team_id: "T1", user_id: "B1" };
    if (method === "users.info")
      return { ok: true, user: { id: "U1", team_id: "T1", real_name: "Alice" } };
    throw new Error(`Unexpected Slack API call: ${method}`);
  });
  const adapter = createSlackAdapter({ app, botToken: "xoxb-test" });
  try {
    await adapter.start({
      message: (message) => void messages.push(message),
      answer: () => "stale",
      prompt: () => undefined,
      accepts: () => true,
    });
    expect(slackManifest().settings.event_subscriptions.bot_events).toContain(
      "agent_session_stopped",
    );
    const stop = listeners.get("agent_session_stopped");
    expect(stop).toBeDefined();
    const event = {
      type: "agent_session_stopped",
      channel: "C1",
      thread_ts: "100",
      event_ts: "200",
      user: "U1",
      streaming_message_ts: [],
    };
    await stop!({ event, context: { teamId: "T2" } });
    expect(messages).toEqual([]);
    await stop!({ event, context: { teamId: "T1" } });
    expect(messages).toEqual([
      {
        id: "stop:200",
        thread: { channel: "C1", thread: "100" },
        author: { id: "U1", name: "Alice", guest: false },
        text: "stop",
        files: [],
        mentioned: true,
        inThread: true,
      },
    ]);
  } finally {
    await adapter.stop();
    api.mockRestore();
  }
});

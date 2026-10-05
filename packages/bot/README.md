# @gitterm/bot

The engine behind [`@gitterm/slack-bot`](https://www.npmjs.com/package/@gitterm/slack-bot) and [`@gitterm/discord-bot`](https://www.npmjs.com/package/@gitterm/discord-bot).
It turns chat messages into [GitTerm](https://gitterm.dev) agent runs with one opinionated model:

- **One sandbox per bot, tenant, channel and repository**, tagged for safe recovery. It pauses when
  idle and is woken by the next message.
- **One OpenCode session per chat thread.** Follow-ups continue the session; messages posted in
  between travel along as quoted context; images are attached once.
- **Questions and tool approvals become chat prompts** with buttons and typed replies.
- **Restarts reattach** to runs that were in flight.

Use it directly to put the same agent behind another chat platform. You write a `ChatAdapter`;
the engine owns sandboxes, sessions, runs, prompts, and recovery.

```ts
import { createBot, type ChatAdapter } from "@gitterm/bot";

const adapter: ChatAdapter = {
  platform: "matrix",
  displayName: "Matrix",
  async start(events) {
    // Connect, then report every message in a thread with events.message({...}).
    // Buttons call events.answer(promptId, answer, user).
    return { scope: "<installation id>" };
  },
  async stop() {},
  async history(thread, after) {
    /* the thread's messages, oldest first */ return [];
  },
  async post(thread, text) {
    /* post a status line, return its id */ return "id";
  },
  async edit(thread, messageId, text) {},
  async remove(thread, messageId) {},
  async reply(thread, markdown, footer) {
    /* split with splitMessage() */
  },
  async ask(thread, prompt) {
    /* render a question or permission prompt */ return "id";
  },
  async settle(thread, messageId, prompt, outcome) {
    /* remove its controls */
  },
};

await createBot({ adapter, repo: "https://github.com/acme/app" }).start();
```

`createBot` takes the same options as the platform bots (`repo`, `channels`, `connections`,
`model`, `instructions`, `workspace`, `stateFile`, timeouts); see the
[Slack bot README](https://www.npmjs.com/package/@gitterm/slack-bot#configuration). `splitMessage`, `tablesToCode`, and
`interpretTypedAnswer` are exported for adapters.

The engine reports a message to the agent only when `mentioned` is true. Other thread replies
answer an open prompt when they come from the person who asked. Every message id must be unique
within its thread, and `history(thread, after)` must return only messages after `after`.

Two adapter methods are optional: `mark(message, state)` reacts to a request (👀, then ✅ or ❌), and
`indicate(thread, status)` shows a native "is working…" indicator instead of a status message
(`""` hides it; resolve `false` to fall back to status messages).

## Security and operations

- **A saved bot's token is the bot, not you.** It reaches only the workspaces it created and only
  its saved repository, model and tools. Call `withSavedConfig()` before `createBot()`: if the
  saved settings can't be loaded, startup fails, and local settings can narrow its users and
  channels but never widen them.
- **Sandboxes are per bot, channel and repository.** Private and public channels, and Discord
  servers, never share one; `shareChannels: true` opts trusted channels into one. A direct
  conversation gets its own, terminated after seven days (`directRetentionMs`).
- **Nothing personal is inherited.** Bot sandboxes get none of your saved environment variables or
  agent config, and only the chosen model's credential.
- **Settings changes need `reset`.** A sandbox made with other settings is kept (it may hold work)
  until someone runs `reset` in that channel. Reset doesn't revoke credentials it already received;
  revoke those upstream.
- **Threads run side by side** in their sandbox, each its own session. The agent is told to check
  for other sessions' work before switching branches.
- **`stop` and the deadline cover the whole request**, from waking the sandbox to the run itself,
  and the server cancels a run at its deadline even if the bot is gone. Approvals go to the
  requester unless you set `approvers`; "always allow" is off unless `allowAlways` is on.
- **One process per saved bot.** A second one waits for the first to stop (up to 90 seconds after a
  crash); a process that loses its claim stops with exit code 1. Keep the state file on persistent
  storage so restarts pick up runs in flight.

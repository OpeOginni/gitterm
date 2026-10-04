# @gitterm/bot

The engine behind [`@gitterm/slack-bot`](https://www.npmjs.com/package/@gitterm/slack-bot) and [`@gitterm/discord-bot`](https://www.npmjs.com/package/@gitterm/discord-bot).
It turns chat messages into [GitTerm](https://gitterm.dev) agent runs with one opinionated model:

- **One sandbox per repository**, tagged so any bot process can find it again. It pauses when
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

# @gitterm/discord-bot

A Discord bot that puts a coding agent on your repository. Mention it in a channel and it opens a
thread, an OpenCode agent works on the request in a [GitTerm](https://gitterm.dev) sandbox, asks
back with buttons when it needs a decision, and replies in the thread.

You run one small process anywhere (your laptop, a VPS, Railway, a container). It connects to
Discord's gateway, so it needs no public URL.

## Set up in five minutes

1. **Create the bot.** In the [Discord developer portal](https://discord.com/developers/applications),
   create an application, open **Bot**, copy the token, and turn on **Message Content Intent**
   (the bot reads thread messages for context and typed answers).

2. **Get a GitTerm token** under **Settings → Account → API tokens** (or run `gitterm login`).
   Connect GitHub under **Integrations** so the agent can clone private repositories and open
   pull requests. MCP and Executor connections you have added there are attached as well.

3. **Run it:**

   ```sh
   export DISCORD_BOT_TOKEN=… GITTERM_API_TOKEN=gt_…
   npx @gitterm/discord-bot --repo https://github.com/acme/app
   ```

4. **Invite it.** Open the invite link the bot prints on startup and pick your server. It asks
   only for what it uses: view channels, send messages, create and post in threads, read history,
   add reactions, and embed links.

5. **Mention it** in a channel: `@Acme Agent why does the login page flash on load?`

A `.env` file in the working directory is loaded too.

## How it works

- **One sandbox per repository.** The first message creates a GitTerm workspace for the
  repository. It pauses when idle and wakes up with the next message, so the checkout, installed
  dependencies, and branches stay where the agent left them, and you pay only while it works.
- **One session per thread.** A mention in a channel opens a thread for the conversation; mention
  the bot (or reply to it) in the thread to continue with full context. Anyone in the thread can
  follow up, and messages posted between mentions are passed along as context. Threads work in
  parallel; messages within one thread wait their turn. Mentioning the bot inside a thread you
  started yourself works the same way, with the thread so far as context.
- **It asks back.** Agent questions appear as a card with a button per option (a menu for
  multiple choice or long lists, a dialog for a written answer). Tool approvals show _Allow
  once_, _Always allow_, and _Deny_. The person who asked can also reply in the thread with an
  option number, `yes`, or `no`.
- **Images reach the agent.** PNG, JPEG, GIF, and WebP files up to 5 MB, posted with the mention
  or earlier in the thread, are attached to the run. Other files are only named.
- **Restarts are safe.** Runs live in GitTerm, not in the bot. A restarted bot reattaches to
  running work and posts the result. The state file only holds thread → run ids, so losing it
  costs thread continuity, never sandboxes (they are found by their tags).

### Commands

Mention the bot with one word:

| Command  | What it does                                                          |
| -------- | --------------------------------------------------------------------- |
| `stop`   | Cancel the work in this thread.                                       |
| `status` | Show whether the repository's sandbox is running, paused, or missing. |
| `reset`  | Terminate the sandbox; the next message creates a fresh one.          |
| `help`   | Explain how to use the bot.                                           |

Use `reset` after changing the bot's instructions, connections, or workspace settings: they apply
when a sandbox is created.

## Configuration

| Environment variable              | Meaning                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`               | Bot token.                                                                            |
| `GITTERM_API_TOKEN`               | GitTerm API token. Falls back to the `gitterm login` config.                          |
| `GITTERM_SERVER_URL`              | Self-hosted GitTerm API, e.g. `https://gitterm.example.com/api`.                      |
| `GITTERM_BOT_REPO`                | Repository for every channel; `url#branch` picks a branch. Same as `--repo`.          |
| `GITTERM_BOT_CHANNELS`            | Per-channel repositories by channel id: `1234=https://github.com/acme/api,5678=…`.    |
| `GITTERM_BOT_CONNECTIONS`         | `auto` (default), `none`, or connection ids/names separated by commas.                |
| `GITTERM_BOT_MODEL`               | OpenCode `provider/model` for every run. Same as `--model`.                           |
| `GITTERM_BOT_PROVIDER`            | Compute provider for new sandboxes (`railway`, `e2b`, `daytona`, …).                  |
| `GITTERM_BOT_INSTRUCTIONS`        | Extra agent instructions, e.g. team conventions.                                      |
| `GITTERM_BOT_STATE_FILE`          | Where thread sessions are kept. Default `.gitterm-bot/discord.json`.                  |
| `GITTERM_BOT_RUN_TIMEOUT_MINUTES` | Give up on a request after this long, including time waiting for answers. Default 60. |

With `GITTERM_BOT_CHANNELS` and no `GITTERM_BOT_REPO`, the bot only answers in the listed
channels (copy a channel id with Developer Mode on). `auto` connections attach the GitHub
connection for the repository's owner (or the deployment's shared one) and every connected MCP and
Executor connection.

### From code

```ts
import { createDiscordBot } from "@gitterm/discord-bot";

const bot = createDiscordBot({
  repo: "https://github.com/acme/app#main",
  channels: { "1234567890": "https://github.com/acme/api" },
  instructions: "Run `pnpm test` before opening a pull request.",
  workspace: {
    provider: { type: "railway" },
    setup: { beforeAgent: ["pnpm install"] },
  },
});
await bot.start();
```

`workspace` takes any `workspaces.create()` option from
[`@gitterm/sdk`](https://www.npmjs.com/package/@gitterm/sdk) except the repository, name, agent,
connections, and tags, which the bot owns.

## Hosting

Any machine with Node 22.12+ works. Keep the state file on persistent storage:

```dockerfile
FROM node:22-slim
RUN npm install -g @gitterm/discord-bot
ENV GITTERM_BOT_STATE_FILE=/data/discord.json
VOLUME /data
CMD ["gitterm-discord-bot"]
```

Run one bot process per Discord application. Two processes with the same token would both answer.

## Security

- **Who can use it:** anyone who can post in a channel the bot can see. Use channel permissions
  to decide who that is; anyone there can also approve the agent's tool requests.
- **What the agent can reach:** whatever the attached GitTerm connections allow. Scope the GitHub
  connection and MCP credentials accordingly, and use OpenCode `permission` rules (via
  `workspace.opencode.config`) to deny commands outright.
- **What the bot stores:** GitTerm workspace and run ids, written with mode `0600`. No tokens.
- Agent replies never ping anyone, and only images are forwarded to the agent.

## Limits

- The agent is OpenCode. T3 Code workspaces have no run API for bots to drive.
- A question left unanswered past the workspace's idle timeout lets the sandbox pause, which
  cancels the run.
- Direct messages are not supported; talk to the bot in server channels.

See [`@gitterm/bot`](https://www.npmjs.com/package/@gitterm/bot) to put the same agent behind another chat platform.

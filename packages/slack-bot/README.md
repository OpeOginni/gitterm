# @gitterm/slack-bot

A Slack bot that puts a coding agent on your repository. Mention it in a channel and an OpenCode
agent works on the request in a [GitTerm](https://gitterm.dev) sandbox, asks back with buttons
when it needs a decision, and replies in the thread.

You run one small process anywhere (your laptop, a VPS, Railway, a container). It connects to
Slack over Socket Mode, so it needs no public URL.

## Set up in five minutes

1. **Create the Slack app.** Print the manifest and paste it at
   [api.slack.com/apps](https://api.slack.com/apps) → _Create New App_ → _From a manifest_:

   ```sh
   npx @gitterm/slack-bot manifest "Acme Agent"
   ```

2. **Collect two tokens.** Install the app to your workspace and copy the _Bot User OAuth Token_
   (`xoxb-…`). Under _Basic Information → App-Level Tokens_, create one with the
   `connections:write` scope (`xapp-…`).

3. **Get a GitTerm token** under **Settings → Account → API tokens** (or run `gitterm login`).
   Connect GitHub under **Integrations** so the agent can clone private repositories and open
   pull requests. MCP and Executor connections you have added there are attached as well.

4. **Run it:**

   ```sh
   export SLACK_BOT_TOKEN=xoxb-… SLACK_APP_TOKEN=xapp-… GITTERM_API_TOKEN=gt_…
   npx @gitterm/slack-bot --repo https://github.com/acme/app
   ```

5. **Invite the bot** to a channel (`/invite @Acme Agent`) and mention it:
   `@Acme Agent why does the login page flash on load?`

A `.env` file in the working directory is loaded too.

## How it works

- **One sandbox per repository.** The first message creates a GitTerm workspace for the
  repository. It pauses when idle and wakes up with the next message, so the checkout, installed
  dependencies, and branches stay where the agent left them, and you pay only while it works.
- **One session per thread.** A mention in a channel starts a session; mentioning the bot again in
  the thread continues it with full context. Anyone in the thread can follow up, and messages
  posted between mentions are passed along as context. Threads work in parallel; messages within
  one thread wait their turn.
- **Native progress.** While it works, Slack shows _“Acme Agent is working on it…”_ under the
  thread, the same indicator Slack's AI apps use, with the elapsed time. Workspaces that refuse it
  get a status message the bot keeps up to date instead.
- **It asks back.** Agent questions appear as a card with a button per option (checkboxes for
  multiple choice, a dialog for a written answer). Tool approvals show _Allow once_, _Always
  allow_, and _Deny_. The person who asked can also just reply in the thread with an option
  number, `yes`, or `no`.
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
| `SLACK_BOT_TOKEN`                 | Bot token (`xoxb-…`).                                                                 |
| `SLACK_APP_TOKEN`                 | App-level token with `connections:write` (`xapp-…`).                                  |
| `GITTERM_API_TOKEN`               | GitTerm API token. Falls back to the `gitterm login` config.                          |
| `GITTERM_SERVER_URL`              | Self-hosted GitTerm API, e.g. `https://gitterm.example.com/api`.                      |
| `GITTERM_BOT_REPO`                | Repository for every channel; `url#branch` picks a branch. Same as `--repo`.          |
| `GITTERM_BOT_CHANNELS`            | Per-channel repositories: `C0123=https://github.com/acme/api,C0456=…`.                |
| `GITTERM_BOT_CONNECTIONS`         | `auto` (default), `none`, or connection ids/names separated by commas.                |
| `GITTERM_BOT_MODEL`               | OpenCode `provider/model` for every run. Same as `--model`.                           |
| `GITTERM_BOT_PROVIDER`            | Compute provider for new sandboxes (`railway`, `e2b`, `daytona`, …).                  |
| `GITTERM_BOT_INSTRUCTIONS`        | Extra agent instructions, e.g. team conventions.                                      |
| `GITTERM_BOT_STATE_FILE`          | Where thread sessions are kept. Default `.gitterm-bot/slack.json`.                    |
| `GITTERM_BOT_RUN_TIMEOUT_MINUTES` | Give up on a request after this long, including time waiting for answers. Default 60. |

With `GITTERM_BOT_CHANNELS` and no `GITTERM_BOT_REPO`, the bot only answers in the listed
channels. `auto` connections attach the GitHub connection for the repository's owner (or the
deployment's shared one) and every connected MCP and Executor connection.

### From code

```ts
import { createSlackBot } from "@gitterm/slack-bot";

const bot = createSlackBot({
  repo: "https://github.com/acme/app#main",
  channels: { C0API: "https://github.com/acme/api" },
  model: "anthropic/claude-sonnet-5-5",
  instructions: "Run `pnpm test` before opening a pull request.",
  workspace: {
    provider: { type: "railway" },
    setup: { beforeAgent: ["pnpm install"] },
    opencode: { config: { permission: { bash: "allow", edit: "allow" } } },
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
RUN npm install -g @gitterm/slack-bot
ENV GITTERM_BOT_STATE_FILE=/data/slack.json
VOLUME /data
CMD ["gitterm-slack-bot"]
```

Run one bot process per Slack app. Two processes with the same tokens would both answer.

## Security

- **Who can use it:** anyone in a channel the bot was invited to. Treat channel membership as the
  permission; anyone there can also approve the agent's tool requests.
- **What the agent can reach:** whatever the attached GitTerm connections allow. Scope the GitHub
  connection and MCP credentials accordingly, and use OpenCode `permission` rules (via
  `workspace.opencode.config`) to deny commands outright.
- **What the bot stores:** GitTerm workspace and run ids, written with mode `0600`. No tokens.
- Agent replies never mention `@channel` or `@here`, and only images are forwarded to the agent.

## Limits

- The agent is OpenCode. T3 Code workspaces have no run API for bots to drive.
- A question left unanswered past the workspace's idle timeout lets the sandbox pause, which
  cancels the run.
- Direct messages are not supported; talk to the bot in channels.

See [`@gitterm/bot`](https://www.npmjs.com/package/@gitterm/bot) to put the same agent behind another chat platform.

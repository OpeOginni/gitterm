# @gitterm/slack-bot

A Slack bot that puts a coding agent on your repository. Mention it in a channel and an OpenCode
agent works on the request in a [GitTerm](https://gitterm.dev) sandbox, asks back with buttons
when it needs a decision, and replies in the thread.

You run one small process anywhere (your laptop, a VPS, Railway, a container). It connects to
Slack over Socket Mode, so it needs no public URL.

## Set up in five minutes

1. **Open Bots in the GitTerm dashboard.** One page takes you through a model key, GitHub access,
   the repository, and optional tools. It then creates an API token with exactly the scopes a bot
   needs and gives you a ready `.env`.

2. **Create the Slack app** with the page's _Create the Slack app_ button: Slack opens with the
   app already configured. (Or paste `npx @gitterm/slack-bot manifest "Acme Agent"` at
   [api.slack.com/apps](https://api.slack.com/apps) → _From a manifest_.) Install it to your
   workspace, copy the _Bot User OAuth Token_ (`xoxb-…`) into `SLACK_BOT_TOKEN`, and under
   _Basic Information → App-Level Tokens_ create one with `connections:write` for
   `SLACK_APP_TOKEN` (`xapp-…`).

3. **Start it** next to the `.env`, from the terminal or from your own code:

   ```sh
   npx @gitterm/slack-bot
   ```

   ```ts
   import { createSlackBot } from "@gitterm/slack-bot";

   await createSlackBot({
     repo: "https://github.com/acme/app",
     model: "anthropic/claude-sonnet-4-5",
   }).start(); // tokens from the environment, or botToken / appToken / gitterm: { token }
   ```

   The bot checks everything before it connects (token, model credential, GitHub access, tools,
   compute) and prints what to fix if something is missing.

4. **Invite the bot** to a channel (`/invite @Acme Agent`) and mention it:
   `@Acme Agent why does the login page flash on load?`

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
- **Pick a repository per thread.** With `repos`, people name one in a thread's first message
  (`@Acme Agent in acme/api, why is login slow?`); a channel without a repository asks which one.
  The thread stays on that repository.
- **Credited pull requests.** The agent opens pull requests that start with "Requested by <name> in Slack", without linking the conversation (the repository may be public). The request gets 👀 when picked up, then ✅ or ❌.
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

| Command  | What it does                                                               |
| -------- | -------------------------------------------------------------------------- |
| `stop`   | Cancel the work in this thread.                                            |
| `status` | Show the repository, sandbox state, model, tools, and who may use the bot. |
| `reset`  | Terminate the sandbox; the next message creates a fresh one.               |
| `help`   | Explain how to use the bot.                                                |

Use `reset` after changing the bot's instructions, connections, or workspace settings: they apply
when a sandbox is created.

## Configuration

Every setting works from code and from the terminal. In code, pass it to `createSlackBot()`; on
the command line, set the environment variable (a `.env` file in the working directory is
loaded) or the flag.

| Option           | Environment variable / flag                                                                 | Meaning                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `botToken`       | `SLACK_BOT_TOKEN`                                                                           | Bot token (`xoxb-…`).                                                                                                                                       |
| `appToken`       | `SLACK_APP_TOKEN`                                                                           | App-level token with `connections:write` (`xapp-…`).                                                                                                        |
| `app`            | —                                                                                           | A Bolt app you already run; see [below](#add-it-to-a-bot-you-already-run).                                                                                  |
| `gitterm`        | `GITTERM_API_TOKEN`, `GITTERM_SERVER_URL`                                                   | `{ token, serverUrl }` or a client. Falls back to the `gitterm login` config.                                                                               |
| `repo`           | `GITTERM_BOT_REPO`, `--repo`                                                                | Repository for every channel; `url#branch` picks a branch.                                                                                                  |
| `channels`       | `GITTERM_BOT_CHANNELS` (`C0123=https://github.com/acme/api,…`)                              | Per-channel repositories. Without `repo`, the bot answers only in these channels.                                                                           |
| `repos`          | `GITTERM_BOT_REPOS`                                                                         | More repositories people can name in a thread's first message (`in acme/api`).                                                                              |
| `connections`    | `GITTERM_BOT_CONNECTIONS` (`Linear,Sentry`)                                                 | Tools besides GitHub, by name as shown under Integrations, integration key (`executor`), or id. GitHub access for the repository is attached automatically. |
| `model`          | `GITTERM_BOT_MODEL`, `--model`, `GITTERM_BOT_MODEL_CREDENTIAL`, `GITTERM_BOT_MODEL_API_KEY` | `provider/model` for every run; only that provider's credential reaches the sandbox. See [Models](#models).                                                 |
| `instructions`   | `GITTERM_BOT_INSTRUCTIONS`, `GITTERM_BOT_INSTRUCTIONS_FILE`, `--instructions-file`          | What the agent should know and how it should behave; see [Instructions](#instructions).                                                                     |
| `env`            | `GITTERM_BOT_SANDBOX_ENV_FILE` (a dotenv file)                                              | Environment variables for new sandboxes, e.g. test credentials.                                                                                             |
| `setup`          | `GITTERM_BOT_SETUP`                                                                         | Commands run in the checkout before the agent starts, e.g. `pnpm install`.                                                                                  |
| `allowedUsers`   | `GITTERM_BOT_ALLOWED_USERS`                                                                 | Only these user ids may use the bot. Default: everyone in the channel.                                                                                      |
| `allowGuests`    | `GITTERM_BOT_ALLOW_GUESTS=true`                                                             | Let guests and people from other organisations in shared channels use the bot. Default off.                                                                 |
| `workspace`      | `GITTERM_BOT_PROVIDER` (provider only)                                                      | Any `workspaces.create()` setting for new sandboxes: provider, image, setup, OpenCode config.                                                               |
| `stateFile`      | `GITTERM_BOT_STATE_FILE`                                                                    | Where thread sessions are kept. Default `.gitterm-bot/slack.json`.                                                                                          |
| `runTimeoutMs`   | `GITTERM_BOT_RUN_TIMEOUT_MINUTES`                                                           | Give up on a request after this long, including time waiting for answers. Default 60 min.                                                                   |
| `inputTimeoutMs` | —                                                                                           | How long a question or approval waits for an answer. Default 30 min.                                                                                        |
| `logger`         | —                                                                                           | Where the bot logs. Default `console`.                                                                                                                      |

GitHub access is automatic: GitTerm attaches the GitHub connection that covers the repository's
owner, or the deployment's shared one. Tools are attached only when you name them, because the
bot acts with your accounts on behalf of everyone in the channel. `workspace` takes any
[`@gitterm/sdk`](https://www.npmjs.com/package/@gitterm/sdk) `workspaces.create()` option except
the repository, name, agent, connections, and tags, which the bot owns.

### Instructions

Tell the agent about your team and how to behave. The text is added after the bot's own rules and
loaded into every session:

```ts
import { readFile } from "node:fs/promises";

createSlackBot({
  repo: "https://github.com/acme/app",
  instructions: await readFile("bot-instructions.md", "utf8"),
});
```

```sh
npx @gitterm/slack-bot --repo https://github.com/acme/app --instructions-file bot-instructions.md
```

Instructions are written into a sandbox when it is created; after changing them, mention the bot
with `reset`. Project knowledge that belongs with the code (how to run tests, where things live)
is better in an `AGENTS.md` in the repository, which OpenCode reads on its own.

### Models

Pick the model and the bot hands the sandbox that one provider's credential, nothing else. A
sandbox anyone in the channel can drive should not hold every model account on your dashboard.

```ts
model: "anthropic/claude-sonnet-5-5"                                    // the provider's default saved credential
model: { id: "anthropic/claude-sonnet-5-5", credential: "team" }        // a saved credential by label
model: { id: "anthropic/claude-sonnet-5-5", apiKey: process.env.KEY }   // a key for this bot only, never saved
```

On the command line: `GITTERM_BOT_MODEL`, plus `GITTERM_BOT_MODEL_CREDENTIAL` or
`GITTERM_BOT_MODEL_API_KEY`. Models that need no key (such as OpenCode's free models) get no
credential. Without a model, the sandbox gets every saved dashboard credential and the dashboard's
default model. Credentials are set when a sandbox is created; after switching to another
provider, mention the bot with `reset`.

## Running from code

`createSlackBot()` returns `{ start(), stop() }`. `start()` resolves once the bot is connected;
`stop()` disconnects it. Runs keep going in GitTerm while the bot is down, and the next
`start()` picks them up.

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
  logger: myLogger, // anything with info, warn, and error
});

await bot.start();
process.once("SIGTERM", () => void bot.stop());
```

### Add it to a bot you already run

Pass your Bolt app and the agent answers its mentions alongside your own listeners. You keep
starting and stopping the app, with whatever receiver it uses (Socket Mode or HTTP). Your app
needs the scopes and events from `npx @gitterm/slack-bot manifest`; make sure none of your own
listeners also answer `app_mention`.

```ts
import { App } from "@slack/bolt";
import { createSlackBot } from "@gitterm/slack-bot";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
app.command("/deploy", async ({ ack }) => {
  await ack("Deploying…");
});

await createSlackBot({ app, repo: "https://github.com/acme/app" }).start();
await app.start(3000);
```

An app that authorizes per workspace also needs `botToken`, which the agent uses for its own API
calls and file downloads.

### Slack and Discord in one process

```ts
import { createDiscordBot } from "@gitterm/discord-bot";
import { createSlackBot } from "@gitterm/slack-bot";

const settings = {
  repo: "https://github.com/acme/app",
  gitterm: { token: process.env.GITTERM_API_TOKEN },
};
await Promise.all([createSlackBot(settings).start(), createDiscordBot(settings).start()]);
```

Each platform gets its own sandbox and its own state file.

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

- **Who can use it:** full members of the workspace in channels the bot was invited to, or only
  the `allowedUsers` you list. Guests and people from other organisations in shared channels are
  refused (and cannot press approval buttons) unless you set `allowGuests`.
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

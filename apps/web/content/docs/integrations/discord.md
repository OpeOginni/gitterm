---
title: Discord
description: Set up the Gitterm Discord bot, host it yourself, manage its saved settings, and use it in a thread.
---

The Discord bot (`@gitterm/discord-bot`) puts an OpenCode agent on your repository. Mention it in a channel and it opens a thread. The agent works on the request in a Gitterm workspace, asks back with buttons when it needs a decision, and replies in the thread. Read this page to set the bot up, run it, and configure it.

You host one small process yourself: on your laptop, a VPS, Railway, or in a container. It connects to Discord's gateway, so it needs no public URL. The agent runs in an OpenCode workspace; the bots don't support T3 Code.

## Before you start

- A Gitterm account with a model credential under **Models**. See [Agents](/docs/workspaces/agents#model-credentials).
- GitHub access to the repository: a GitHub connection, or your own GitHub token. See [Connections](/docs/integrations/connections#github).
- A Discord server where you can add bots.
- Docker, or Node 22.12 or later, on the machine that will run the bot.

## Set it up

All steps are required.

1. **Create the bot in Gitterm.** In the dashboard, open **Bots** and click **New bot**. Fill in **Model** and **Repository**, and choose **Discord** under **Platform**. **Compute**, **Tools** and **Behavior** (channels, people, instructions, setup command) are optional. Under **Deploy**, name the bot and click **Create bot**.

   You should see a `.env` under **Save this as .env**, with the bot's `GITTERM_API_TOKEN`. The token is shown only once, so copy the file now. **New token** replaces a lost one.

2. **Create the Discord application.** In the [Discord developer portal](https://discord.com/developers/applications), create an application and open its **Bot** page. Click **Reset Token** and copy the token. Turn on **Message Content Intent**, so the bot can read thread messages for context and typed answers.

3. **Add the Discord token to the `.env`:**

   ```sh
   GITTERM_API_TOKEN=gt_...
   DISCORD_BOT_TOKEN=...
   ```

4. **Start the bot** in the folder that holds the `.env`:

   ```sh
   npx @gitterm/discord-bot
   ```

   To run it in Docker instead, see [Host it with Docker](#host-it-with-docker). Before it connects, the bot checks the token, model credential, GitHub access, tools and compute. You should see a `✓` line for each, an `Invite the bot:` link, and `GitTerm Discord bot is running for <repository>.` Missing GitHub access or a missing model credential prints a `!` warning, and the bot still starts. Any other problem prints what to fix and exits.

5. **Invite it.** Open the `Invite the bot:` link and pick your server. The bot asks only for what it uses: view channels, send messages, create and post in threads, read message history, add reactions, and embed links.

6. **Mention it** in a channel:

   ```text
   @Acme Agent why does the login page flash on load?
   ```

   You should see a 👀 reaction on your message and a new thread with the reply.

## Use it in a thread

- **Mention to start.** A mention in a channel opens a thread for the conversation. Mention the bot, or reply to it, in the thread to continue with full context. Anyone in the thread can follow up, and messages posted between mentions are passed along. In a thread you started yourself, a mention works too, with the thread so far as context.
- **One session per thread.** Threads run side by side. Messages in one thread wait their turn.
- **It asks back.** Questions show a button per option, a menu for multiple choice or long lists, or a dialog for a written answer. Tool approvals show **Allow once**, **Always allow** (only if enabled) and **Deny**. The person who asked can also reply with an option number, `yes`, or `no`.
- **Images reach the agent.** PNG, JPEG, GIF and WebP files up to 5 MB, posted with the mention or earlier in the thread, are attached. Other files are only named.
- **Pick a repository.** If the bot has more than one repository, name one in the first message: `@Acme Agent in acme/api, why is login slow?`. The thread stays on that repository.
- **Progress.** The request gets a 👀 reaction when picked up, then ✅ or ❌.

Pull requests the agent opens start with `Requested by <name> in Discord`, without a link to the conversation. Direct messages aren't supported; talk to the bot in server channels.

### Commands

Mention the bot with one word:

| Command  | What it does                                                                |
| -------- | --------------------------------------------------------------------------- |
| `stop`   | Cancel the work in this thread                                              |
| `status` | Show the repository, workspace state, model, tools, and who may use the bot |
| `reset`  | Terminate the workspace. The next message creates a fresh one               |
| `help`   | Explain how to use the bot                                                  |

## How workspaces are used

- Each repository gets one workspace per channel. It pauses when idle and wakes with the next message, so the checkout, installed dependencies and branches stay where the agent left them.
- Different servers never share a workspace. Set `GITTERM_BOT_SHARE_CHANNELS=true` to let equally trusted channels share one.
- The workspace name uses only the repository name: `acme/api` becomes `discord-bot-api`. Open it from the dashboard to see every thread's session. See [Connect to a workspace](/docs/workspaces/connect#bot-workspaces).
- A bot workspace gets only the chosen model's credential. It gets none of your saved environment variables or agent config.

## Saved settings

The bot loads its saved settings from Gitterm, using its API token, each time it starts. Change them on the bot's page under **Bots**. A running bot applies saved changes to new requests without a restart.

Settings reach a workspace when it is created. After you change instructions, tools, the model's provider, or workspace settings, the bot asks for a reset: mention it with `reset` in each channel.

Environment variables and code options can narrow the saved settings (fewer channels or people) but never widen them. A repository, model or connection that isn't in the saved settings stops the bot with an error.

## Host it with Docker

One image runs the Slack or the Discord bot; it picks the platform from the tokens in the `.env`. Run it in the folder that holds the `.env`:

```sh
docker run -d --name gitterm-discord-bot --restart unless-stopped \
  -v "$PWD/.env:/data/.env:ro" -v gitterm-discord-bot:/data \
  ghcr.io/opeoginni/gitterm-bot
```

Mount the `.env` as shown; `--env-file` doesn't read dotenv quoting. Thread state is kept in the `/data` volume. Follow the logs, including the invite link, with `docker logs -f gitterm-discord-bot`.

Without Docker, keep the `.gitterm-bot/` folder on persistent storage so a restart picks up runs in progress.

Run one process per Discord application. A second process for the same saved bot waits for the first to stop: up to 90 seconds after a crash.

## Configuration

Set environment variables (a `.env` in the working directory is loaded) or the matching code option. For a bot created under **Bots**, only the tokens are required; saved settings fill in the rest. To copy channel and user ids, turn on Developer Mode in Discord.

| Variable                                                                           | Option                                    | Required                    | Default                            | What it does                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`                                                                | `token`                                   | Yes                         | None                               | Bot token                                                                             |
| `GITTERM_API_TOKEN`                                                                | `gitterm`                                 | Yes, for a saved bot        | The `gitterm login` token          | The bot's Gitterm token                                                               |
| `GITTERM_SERVER_URL`                                                               | `gitterm`                                 | Only if self-hosted         | `https://api.gitterm.dev`          | Gitterm API URL                                                                       |
| `GITTERM_BOT_REPO`, `--repo`                                                       | `repo`                                    | Only without saved settings | Saved settings                     | Repository for every channel. `<url>#<branch>` picks a branch                         |
| `GITTERM_BOT_CHANNELS`                                                             | `channels`                                | No                          | None                               | Per-channel repositories: `1234=https://github.com/acme/api,…`                        |
| `GITTERM_BOT_REPOS`                                                                | `repos`                                   | No                          | None                               | More repositories people can name in a thread                                         |
| `GITTERM_BOT_MODEL`, `--model`                                                     | `model`                                   | No                          | Saved settings                     | `provider/model` for every run. Only that provider's credential reaches the workspace |
| `GITTERM_BOT_MODEL_CREDENTIAL`                                                     | `model.credential`                        | No                          | The provider's default             | Saved credential label. Needs `GITTERM_BOT_MODEL`                                     |
| `GITTERM_BOT_MODEL_API_KEY`                                                        | `model.apiKey`                            | No                          | None                               | A model key for this bot only, never saved. Needs `GITTERM_BOT_MODEL`                 |
| `GITTERM_BOT_CONNECTIONS`                                                          | `connections`                             | No                          | None                               | Tools besides GitHub, by name, key or id: `Linear,Sentry`                             |
| `GITTERM_BOT_GITHUB_TOKEN`                                                         | `workspace.repositoryCredentials`         | No                          | A Gitterm GitHub connection        | Your own GitHub token instead of a connection                                         |
| `GITTERM_BOT_INSTRUCTIONS`, `GITTERM_BOT_INSTRUCTIONS_FILE`, `--instructions-file` | `instructions`                            | No                          | None                               | Extra instructions for the agent                                                      |
| `GITTERM_BOT_SETUP`                                                                | `setup`                                   | No                          | None                               | Command run in the checkout before the agent starts, such as `pnpm install`           |
| `GITTERM_BOT_SANDBOX_ENV_FILE`                                                     | `env`                                     | No                          | None                               | A dotenv file of variables for new workspaces                                         |
| `GITTERM_BOT_PROVIDER`                                                             | `workspace.provider`                      | No                          | Your default provider              | Compute provider for new workspaces, such as `e2b`                                    |
| `GITTERM_BOT_ALLOWED_USERS`                                                        | `allowedUsers`                            | No                          | Anyone who can post in the channel | Only these user ids may use the bot                                                   |
| `GITTERM_BOT_ALLOWED_CHANNELS`                                                     | `allowedChannels`                         | No                          | Every channel the bot can see      | Only these channel ids                                                                |
| `GITTERM_BOT_APPROVERS`                                                            | `approvers`                               | No                          | The requester                      | Who may approve tool requests                                                         |
| `GITTERM_BOT_ALLOW_ALWAYS=true`                                                    | `allowAlways`                             | No                          | Off                                | Show **Always allow** on tool approvals                                               |
| `GITTERM_BOT_SHARE_CHANNELS=true`                                                  | `shareChannels`                           | No                          | Off                                | Let channels share one workspace                                                      |
| `GITTERM_BOT_MAX_PENDING`, `GITTERM_BOT_MAX_PENDING_PER_USER`                      | `maxPendingRequests`, `maxPendingPerUser` | No                          | 20 total, 3 per user               | Queue limits                                                                          |
| `GITTERM_BOT_STATE_FILE`                                                           | `stateFile`                               | No                          | `.gitterm-bot/discord.json`        | Where thread sessions are kept                                                        |
| `GITTERM_BOT_RUN_TIMEOUT_MINUTES`                                                  | `runTimeoutMs`                            | No                          | 60 minutes                         | Give up on a request after this long, including time waiting for answers              |
|                                                                                    | `inputTimeoutMs`                          | No                          | 30 minutes                         | How long a question waits for an answer                                               |
| `GITTERM_BOT_ID`                                                                   | `botId`                                   | No                          | Saved bots use their own id        | Names the workspaces of a bot without saved settings                                  |

Without a model, no saved model credential reaches the workspace.

## Run it from code

```ts
import { createDiscordBot, withSavedConfig } from "@gitterm/discord-bot";

const bot = createDiscordBot(
  await withSavedConfig({
    workspace: { setup: { beforeAgent: ["pnpm install"] } },
  }),
);
await bot.start();

const shutdown = () => void bot.stop().finally(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
```

`withSavedConfig()` loads the settings saved for the token. A saved bot must call it before `start()`. To add the agent to a discord.js client you already run, pass it as `client`. The client needs the `Guilds`, `GuildMessages` and `MessageContent` intents, and none of your own handlers should answer mentions of the bot.

## Security

- **Who can use it:** anyone who can post in a channel the bot can see, unless you set allowed users. Then only those people can make requests and approve tool requests. Use Discord channel permissions for the rest.
- **What the agent can reach:** whatever the attached connections allow. Scope the GitHub connection and MCP credentials to match. To deny commands, set OpenCode `permission` rules in `workspace.opencode.config`.
- **What the bot stores:** Gitterm workspace and run ids, in a file with mode `0600`. No tokens.
- Replies never ping anyone.
- A question left unanswered past the workspace's idle timeout lets the workspace pause, which cancels the run.

## Related

- [Slack](/docs/integrations/slack)
- [Connections](/docs/integrations/connections)
- [SDK reference](/docs/reference/sdk)

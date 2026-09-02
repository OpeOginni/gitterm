# Gitterm Slack agent

This is a **demo**. Anyone in a channel the bot can read can mention it and run an agent with `bash` and `edit` allowed against the configured repository and compute account. Do not install it in a shared or public Slack workspace without adding your own authorization.

This example includes two Socket Mode Slack bots:

- `slack-bot.ts` runs OpenCode agents through the hosted Gitterm API. It uses the account's configured provider, billing, credentials, workspace policy, durable run history, and workspace lifecycle management.
- `slack-bot-direct.ts` uses `@gitterm/sdk/direct` to run directly in your E2B account without a Gitterm server.

Both variants add Slack-specific context to the generated global `AGENTS.md`; the model system prompt is not modified.

## Configure Slack

1. Create a Slack app and enable Socket Mode.
2. Add the `app_mentions:read`, `channels:history`, `chat:write`, and `groups:history` bot scopes.
3. Subscribe to the `app_mention` bot event and install the app. The direct variant also needs `message.channels` and `message.groups` for its unmentioned thread-reply behavior.
4. Create an app-level token with `connections:write`.

## Run

```bash
cp .env.example .env
bun install
bun run start
```

For hosted mode, the Gitterm account must have an available compute provider and model credential configured. Set `GITTERM_API_TOKEN`; the bot does not need an E2B API key.

The hosted bot uses `http://localhost:3000` by default and explicitly provisions E2B workspaces. Set `GITTERM_SERVER_URL` if your Gitterm server runs elsewhere.

For direct E2B mode, set `E2B_API_KEY` and run:

```bash
bun run start:direct
```

Direct mode does not use `GITTERM_API_TOKEN`. `E2B_SIZE` defaults to `standard`; `E2B_TEMPLATE_ID` can select a custom OpenCode-compatible template.

## Threads

A Slack thread is one agent session, like a Discord thread:

- Mention the bot in a channel to start a session. The bot replies in that message's thread.
- In hosted mode, human replies do not invoke the bot. Mention it again in the thread to continue the same OpenCode session; messages added since its previous invocation are supplied as context.
- If the first mention is already inside a thread, that thread's existing messages are sent as context once, then the native session takes over.
- Set `GITTERM_BOT_PRECONTEXT=true` to also attach recent channel messages before a top-level mention. Off by default.

Hosted mode uses one persistent workspace per Slack channel and a separate OpenCode session per Slack thread. New top-level mentions start isolated sessions; replies continue that thread's run. Requests are serialized per thread, so different threads in a channel run concurrently on the shared workspace. The bot leaves the workspace running between requests and relies on Gitterm's idle timeout to pause it; a mention that arrives while it is paused resumes it first. If Gitterm has deleted or terminated it, the bot creates a replacement and starts the requesting thread with its Slack transcript as context.

Hosted responses use Slack blocks. Markdown tables are converted to aligned, monospaced table sections; longer responses are split across safe-sized block messages.

Direct mode continues to use one workspace per Slack thread.

Hosted channel and thread state is stored in `GITTERM_BOT_STATE_FILE` with mode `0600`. It contains Gitterm workspace and run IDs, not provider secrets.

Direct thread state is stored separately in `GITTERM_BOT_DIRECT_STATE_FILE`, also with mode `0600`. The serialized direct workspace contains the OpenCode password and E2B routing token. Treat it as credential material and use encrypted storage instead of this demo JSON file in production.

Replace either small JSON store with Redis or a database before running multiple bot replicas.

Set `GITTERM_API_TOKEN` to a token created under **Gitterm Dashboard → Settings → Account → API tokens**. Configure model credentials in the Gitterm dashboard, or provide `ANTHROPIC_API_KEY` for this bot's workspaces.

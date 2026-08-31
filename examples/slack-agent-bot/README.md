# Gitterm direct-provider Slack agent

This is a **demo**. Anyone in a channel the bot can read can mention it and run an agent with `bash` and `edit` allowed against the configured repository and compute account. Do not install it in a shared or public Slack workspace without adding your own authorization.

This Socket Mode Slack bot runs OpenCode agents on the team's own compute account. It supports E2B, Daytona, Vercel Sandbox, Ascii Box, exe.dev, and Railway without connecting to a hosted or self-hosted Gitterm server. Gitterm billing, proxying, team policy, durable run history, and managed cleanup are not involved.

## Configure Slack

1. Create a Slack app and enable Socket Mode.
2. Add the `app_mentions:read`, `channels:history`, `chat:write`, and `groups:history` bot scopes.
3. Subscribe to the `app_mention` bot event and install the app.
4. Create an app-level token with `connections:write`.

## Run

```bash
cp .env.example .env
bun install
bun run start
```

Select `GITTERM_PROVIDER` and fill in its block in `.env.example`. E2B requires a template containing Node.js, git, and `opencode`.

## Lifecycle

- `ephemeral` creates and destroys a sandbox for every mention. This is the safest default for independent tasks.
- `thread` gives each Slack thread a persistent sandbox, pausing it after each response and resuming it for the next mention.
- `persistent` keeps one workspace alive per Slack channel and refreshes its provider timeout when supported.

Railway requires persistent storage for thread pause/resume; the bot requests persistent workspaces in `thread` and `persistent` modes.

Provider subscription OAuth can be initiated with `gitterm.auth.connectOAuth()` and the authorization URL and device instructions can be posted back to Slack. Use `thread` or `persistent` lifecycle when doing this: OpenCode keeps and refreshes the credential inside the reused workspace, so users authenticate once for that workspace.

For `ephemeral`, the bot can instead own each Slack installation's encrypted OAuth token bundle and pass it through `modelCredentials` when creating every sandbox, or call `gitterm.auth.setCredential()` on a running sandbox. The bot then owns token refresh and persistence; workspace-local token refreshes are not synchronized back to the bot. Use the managed Gitterm control plane when that credential lifecycle should be managed centrally.

## Context

- `thread` sends the current Slack thread transcript in a fresh OpenCode session.
- `session` reuses the native OpenCode session and sends only the latest request.
- `both` reuses the native session and includes the Slack transcript. This is resilient when people add context outside bot mentions, but can repeat context.

Thread and persistent state is stored in `GITTERM_BOT_STATE_FILE` with mode `0600`. The workspace handles are serializable; replace the small JSON store with Redis or a database before running multiple bot replicas. Provider and model keys are sent directly to E2B/OpenCode and are not sent to Gitterm.

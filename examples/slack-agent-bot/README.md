# Gitterm direct-provider Slack agent

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

## Context

- `thread` sends the current Slack thread transcript in a fresh OpenCode session.
- `session` reuses the native OpenCode session and sends only the latest request.
- `both` reuses the native session and includes the Slack transcript. This is resilient when people add context outside bot mentions, but can repeat context.

Thread and persistent state is stored in `GITTERM_BOT_STATE_FILE` with mode `0600`. The workspace handles are serializable; replace the small JSON store with Redis or a database before running multiple bot replicas. Provider and model keys are sent directly to E2B/OpenCode and are not sent to Gitterm.

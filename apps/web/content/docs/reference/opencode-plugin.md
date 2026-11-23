---
title: OpenCode plugin reference
nav: OpenCode plugin
description: Install, options, environment variables, tools and commands of @gitterm/opencode, the plugin for sandboxes and /cloud.
---

This is the reference for `@gitterm/opencode`, Gitterm's OpenCode plugin: every option, account field, limit, environment variable, tool, and command. Use it to look up a field. For step-by-step use, see [Sandbox setup](/docs/sandboxes/setup), [Move a session](/docs/workspaces/move-a-session) and [Bring a session back](/docs/workspaces/return-a-session).

It needs OpenCode 2.3.0 or later. It replaces `@gitterm/opencode-sandbox` and `@gitterm/opencode-cloud`; see [Moving from the old plugins](#moving-from-the-old-plugins).

## Install

```sh
npx @gitterm/cli setup
```

`gitterm setup` installs the plugin for OpenCode, sets up your other agents, and signs you in. To install only the plugin:

```sh
opencode plugin add @gitterm/opencode
```

This adds it to your global OpenCode config. You can instead list it under `plugins` in a project's `opencode.json`, or in `~/.config/opencode/opencode.json` for all projects. To pass options, replace the string entry with an object. Keep your other settings and plugin entries.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@gitterm/opencode",
      "options": {
        "sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
      },
    },
  ],
}
```

Restart OpenCode after changing the options. When you load the plugin from a local path, point `package` at the package directory, not a file.

## What turns on

Each part of the plugin turns on by itself when it can work. There is no setting to turn a part off.

| You have                                                   | Sandbox tools                    | `/cloud` and `/cloud-return`     |
| ---------------------------------------------------------- | -------------------------------- | -------------------------------- |
| A Gitterm login (gitterm.dev or self-hosted), no `sandbox` | Yes, billed to your Gitterm plan | Yes                              |
| A Gitterm login and a `sandbox` account                    | Yes, with that account           | Yes                              |
| A `sandbox` account with your own provider key, no login   | Yes                              | No: moving needs a Gitterm login |
| Neither                                                    | No                               | Yes: `/cloud` signs you in       |

Restart OpenCode after signing in, so the sandbox tools appear.

## Sign in

Moving a session, and sandboxes billed to a Gitterm plan, need a Gitterm account. Sandboxes with your own provider key do not.

You don't have to sign in first: if you aren't signed in, or your login expired, `/cloud` shows a link, a QR code and a code. Open the link, sign in or create an account, and approve the code. The dialog closes by itself and `/cloud` carries on. Esc cancels.

The login is saved where the CLI keeps it, so `gitterm login` signs the plugin in too, and the plugin's login signs in the CLI. For a self-hosted deployment, set the `serverUrl` option, or run `gitterm login --server <url>`, where `<url>` is your Gitterm API URL. You can instead set `GITTERM_API_TOKEN` (and `GITTERM_SERVER_URL`) before starting OpenCode; a token set this way or in `token` is never replaced by signing in.

Your model keys stay on your computer. In the cloud, the agent can use free models, or the models you add under **Models** in Gitterm, which we recommend. With none added, `/cloud` suggests it before creating a workspace: continue with the free models, or add one at the link it shows and choose **Check again**; the same `/cloud` carries on.

## Options

Every option is optional.

| Option                | Type     | Required                             | Default                  | What it does                                                                                                                    |
| --------------------- | -------- | ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox`             | object   | No                                   | Your Gitterm login       | The sandbox account and its settings. See [Sandbox options](#sandbox-options).                                                  |
| `serverUrl`           | string   | No                                   | Saved CLI login          | Gitterm API URL, for `/cloud` and for sandboxes billed to Gitterm.                                                              |
| `token`               | string   | No                                   | Saved CLI login          | Gitterm API token. Prefer `gitterm login` or `GITTERM_API_TOKEN`.                                                               |
| `provider`            | object   | No                                   | Your Gitterm default     | Provider for the cloud workspace, for example `{ "type": "e2b" }`. Must be enabled on your deployment.                          |
| `connections`         | string[] | Only for private repositories        | None                     | Saved Gitterm connections to attach, by id, name, or integration key. `"github"` picks a connection that covers the repository. |
| `name`                | string   | No                                   | The conversation title   | Cloud workspace name.                                                                                                           |
| `persistent`          | boolean  | No                                   | Not requested            | Requests persistent storage for the cloud workspace where the provider supports it.                                             |
| `envFiles`            | string[] | No                                   | None                     | Env files, relative to the checkout, whose variables the cloud workspace gets. Later files win.                                 |
| `localServerUrl`      | string   | Only for standalone OpenCode servers | Discovered automatically | Loopback URL of your local OpenCode server: `localhost`, `127.0.0.1`, or `[::1]`, with no credentials in the URL.               |
| `localServerPassword` | string   | Only if that server needs one        | None                     | Password for that local server.                                                                                                 |

`serverUrl` and `token` resolve in this order: the option, then `GITTERM_SERVER_URL` / `GITTERM_API_TOKEN`, then the saved CLI login. The server defaults to `https://api.gitterm.dev`.

### Sandbox options

These go in `sandbox`, next to one account's [fields](#account-fields). For several accounts, put them under `sandbox.accounts` instead. Without `sandbox`, sandboxes go through the Gitterm account you are signed in to.

| Option           | Type     | Required | Default               | What it does                                                                                                                                                                                                                                                  |
| ---------------- | -------- | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`        | string   | No       | None                  | With `accounts`: name of the account the tools use.                                                                                                                                                                                                           |
| `accounts`       | object   | No       | None                  | Map of account name to [account fields](#account-fields), for several accounts. A single account inline is named after its `provider`, or `gitterm` without one.                                                                                              |
| `limits`         | object   | No       | See [limits](#limits) | Caps on what the agent can start.                                                                                                                                                                                                                             |
| `exclude`        | string[] | No       | None                  | Extra glob patterns `sandbox_sync` never uploads. Secret-like files are always left out.                                                                                                                                                                      |
| `maxSourceMiB`   | integer  | No       | `100`                 | Maximum working tree size before compression for `sandbox_sync`, in MiB. Accepts 1–1024.                                                                                                                                                                      |
| `publicPreviews` | boolean  | No       | `false`               | Creates every sandbox with public previews, without asking. Setting it is your approval. Whether a preview can be public depends on the provider and the kind of account; see [Previews by provider](/docs/sandboxes/jobs-and-previews#previews-by-provider). |
| `snapshots`      | boolean  | No       | `false`               | Lets the agent save a set-up sandbox as a snapshot, so the project's next sandboxes start from it. See [Setup snapshots](/docs/sandboxes/setup#setup-snapshots).                                                                                              |
| `envFiles`       | string[] | No       | None                  | Env files, relative to the checkout, whose variables every sandbox command gets. Later files win.                                                                                                                                                             |

Account names use letters, digits, `_`, `.`, and `-`, start with a letter or digit, and are at most 63 characters.

### Account fields

| Field                        | Applies to                 | Required                               | Default                 | What it does                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------- | -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`                     | Direct                     | Yes, except `e2b`, `daytona`, `exedev` | Their CLI login         | Provider key, as `"{env:VAR}"` or `"{file:path}"`. It makes the account direct; without it the account is managed. E2B, Daytona, and exe.dev accounts can leave it out and use their CLI login. See [Direct accounts](/docs/sandboxes/setup#direct-accounts). |
| `provider`                   | Direct                     | Yes                                    | None                    | `e2b`, `daytona`, `vercel`, `boat`, `exedev`, or `railway`.                                                                                                                                                                                                   |
| `provider`                   | Managed                    | No                                     | The server's default    | One the deployment offers, for example `e2b` or (managed only) `aws`. Gitterm's own sandboxes on gitterm.dev.                                                                                                                                                 |
| `size`                       | Managed                    | No                                     | Your plan's default     | Machine size: `small` or `medium` on gitterm.dev, or one of a self-hosted deployment's machine profiles.                                                                                                                                                      |
| `allowUnboundedLifetime`     | Direct `exedev`, `railway` | Yes (`true`)                           | `false`                 | Accepts that a crashed sandbox runs until you destroy it.                                                                                                                                                                                                     |
| `template`                   | Direct `e2b`               | No                                     | `base`                  | E2B template.                                                                                                                                                                                                                                                 |
| `target`                     | Direct `daytona`           | No                                     | Daytona's default       | Region: `us` or `eu`.                                                                                                                                                                                                                                         |
| `snapshot`                   | Direct `daytona`           | No                                     | None                    | Daytona snapshot to use instead of the default image.                                                                                                                                                                                                         |
| `teamId`, `projectId`        | Direct `vercel`            | Yes                                    | None                    | Vercel team and project.                                                                                                                                                                                                                                      |
| `runtime`                    | Direct `vercel`            | No                                     | `node24`                | `node24`, `node22`, or `python3.13`.                                                                                                                                                                                                                          |
| `size`                       | Direct `boat`              | No                                     | Boat's default          | `small`, `default`, or `large`.                                                                                                                                                                                                                               |
| `image`                      | Direct `exedev`            | No                                     | `node:22-bookworm`      | Container image.                                                                                                                                                                                                                                              |
| `projectId`, `environmentId` | Direct `railway`           | Yes                                    | None                    | Railway project and environment.                                                                                                                                                                                                                              |
| `image`                      | Direct `railway`           | No                                     | `node:22-bookworm-slim` | Container image. Gitterm's command server runs in it.                                                                                                                                                                                                         |
| `apiUrl`                     | Direct `railway`           | No                                     | Railway's API           | Railway API URL. Default: `backboard.railway.app/graphql/v2`.                                                                                                                                                                                                 |
| `serverUrl`                  | Managed                    | No                                     | CLI login               | Gitterm API URL, for self-hosted deployments.                                                                                                                                                                                                                 |
| `token`                      | Managed                    | No                                     | CLI login               | Gitterm API token. Prefer `gitterm login` or `GITTERM_API_TOKEN`.                                                                                                                                                                                             |

For what each provider does with a sandbox, see [Providers](/docs/sandboxes/providers).

### Limits

Set these under `sandbox.limits`. Any field you leave out uses its default.

| Limit                    | Default | What it does                                                                                                                                                                |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxSandboxes`           | `2`     | Live sandboxes per account. `sandbox_create` fails at the limit.                                                                                                            |
| `maxLifetimeMinutes`     | `60`    | Longest lifetime `sandbox_create` accepts.                                                                                                                                  |
| `defaultLifetimeMinutes` | `30`    | Lifetime when the agent does not set one.                                                                                                                                   |
| `maxJobMinutes`          | `30`    | Longest job timeout. Jobs default to 10 minutes or this, whichever is less. Preview servers run until the sandbox's lifetime ends, or this long where the sandbox has none. |

Providers also cap the lifetime: 24 hours, or 5 hours on Vercel.

## Environment variables

| Variable                                 | What it does                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `GITTERM_API_TOKEN`                      | Gitterm API token. Overrides the saved login.                       |
| `GITTERM_SERVER_URL`                     | Gitterm API URL. Overrides the saved login.                         |
| `GITTERM_OPENCODE_LOCAL_SERVER_URL`      | Same as the `localServerUrl` option.                                |
| `GITTERM_OPENCODE_LOCAL_SERVER_PASSWORD` | Same as the `localServerPassword` option.                           |
| `XDG_STATE_HOME`                         | Base directory for local sandbox records. Default `~/.local/state`. |
| `XDG_CACHE_HOME`                         | Base directory for downloaded artifacts. Default `~/.cache`.        |

Set variables before OpenCode starts. This includes variables you reference with `{env:VAR}` and variables you pass to jobs with `secretEnv`. Plugins run in OpenCode's background service, so a variable on the `opencode` command line (`VAR=value opencode`) doesn't reach them once the service is running. Set it on the service and restart it (`opencode service set env VAR value`, then `opencode service restart`), or use `{file:path}` instead.

## Tools

With a sandbox account, the plugin adds these tools. `sandbox_snapshot` needs `snapshots`, and `sandbox_pause` a provider that can pause. You ask in plain words and the agent picks them; their arguments are in [Tools](/docs/sandboxes/tools).

| Tool               | What it does                                                      |
| ------------------ | ----------------------------------------------------------------- |
| `sandbox_create`   | Creates a sandbox                                                 |
| `sandbox_list`     | Shows the selected account, who is charged, limits, and sandboxes |
| `sandbox_sync`     | Uploads the checkout                                              |
| `sandbox_exec`     | Runs a command as a job                                           |
| `sandbox_job`      | Reads a job's status and output, or cancels it                    |
| `sandbox_preview`  | Exposes a port, optionally starting a server first                |
| `sandbox_artifact` | Downloads a file a job produced                                   |
| `sandbox_apply`    | Copies a downloaded file into the checkout                        |
| `sandbox_pause`    | Pauses a sandbox, keeping its files                               |
| `sandbox_destroy`  | Deletes a sandbox                                                 |
| `sandbox_snapshot` | Saves or deletes a setup snapshot (with `snapshots`)              |

Which tools ask for approval, and how to pre-approve them: [Approvals](/docs/sandboxes/setup#approvals).

## Commands

| Command         | What it does                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/cloud`        | Moves this session into a cloud workspace. Run again in the same session to reconnect, or to retry a move that failed. See [Move a session](/docs/workspaces/move-a-session).         |
| `/cloud-return` | Brings the session, and the cloud's commits, changes and conversation, back to this checkout, then ends the workspace. See [Bring a session back](/docs/workspaces/return-a-session). |

`/cloud-return` appears only while a session of the checkout is in the cloud. It needs a Gitterm server that includes cloud return (managed Gitterm does); against an older self-hosted server, `/cloud` fails until the server is updated.

## In the OpenCode terminal

The right sidebar has a **Sandboxes** list with this checkout's live sandboxes, newest first. Each line shows the sandbox name and a dot for its state (green running, yellow pending or paused, red deleting), then any running jobs, preview ports, and its purpose or provider. It refreshes every few seconds from the local sandbox records, never calls the provider, and is hidden when the checkout has no sandboxes.

While a session is in the cloud, the sidebar also has a **Cloud** block, and a status line above the prompt says what the cloud agent is doing: working, needs your input, idle, paused, or deleted. The plugin notifies you when the cloud agent finishes or needs your input, and sending a message in that session locally asks first. Status checks are marked as passive, so they don't keep the workspace from pausing when it is idle.

The desktop app gets the sandbox tools, the check before sending and both commands, but not the sidebar, status line or notifications.

## Moving from the old plugins

1. Install `@gitterm/opencode`. `gitterm setup` does it, and says when an old plugin is still in your config.
2. Move the options:
   - From `@gitterm/opencode-cloud`: keep them as they are, at the top level.
   - From `@gitterm/opencode-sandbox`: put them under `sandbox`.
3. Remove the old plugins, so `/cloud` isn't added twice:

   ```sh
   opencode plugin remove @gitterm/opencode-cloud
   opencode plugin remove @gitterm/opencode-sandbox
   ```

## Related

- [Sandbox setup](/docs/sandboxes/setup)
- [Tools](/docs/sandboxes/tools)
- [Move a session](/docs/workspaces/move-a-session)
- [Bring a session back](/docs/workspaces/return-a-session)
- [Connections](/docs/integrations/connections)
- [CLI reference](/docs/reference/cli#sandboxes)

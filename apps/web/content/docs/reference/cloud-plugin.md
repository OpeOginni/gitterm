---
title: Cloud plugin reference
nav: Cloud plugin
description: Install, options, environment variables, and the /cloud and /cloud-return commands of @gitterm/opencode-cloud.
---

This is the reference for `@gitterm/opencode-cloud`, the OpenCode plugin that adds the `/cloud` and `/cloud-return` commands: every option, environment variable, and command. Use it to look up a field. For step-by-step use, see [Move a session](/docs/workspaces/move-a-session) and [Bring a session back](/docs/workspaces/return-a-session).

Version 0.2.0 or later, with OpenCode 2.3.0 or later. It also needs a Gitterm server that includes cloud return (managed Gitterm does); against an older self-hosted server, `/cloud` fails until the server is updated.

Formerly part of `@gitterm/opencode-plugin`. The `sandbox_*` tools are now a separate plugin; see [Sandbox plugin reference](/docs/reference/sandbox-plugin).

## Install

```sh
opencode plugin add @gitterm/opencode-cloud
```

This installs the plugin and adds it to your global OpenCode config. You can instead list it under `plugins` in a project's `opencode.json`, or in `~/.config/opencode/opencode.json` for all projects:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@gitterm/opencode-cloud"]
}
```

Every option is optional. To pass options, replace the string with an object. Keep your other settings and plugin entries.

```jsonc
{
  "plugins": [
    {
      "package": "@gitterm/opencode-cloud",
      "options": {
        "provider": { "type": "e2b" },
        "connections": ["github"],
      },
    },
  ],
}
```

Restart OpenCode if `/cloud` does not appear. `/cloud-return` appears only while a session of the checkout is in the cloud. When you load the plugin from a local path, point `package` at the package directory, not a file.

## Sign in

Both commands need a Gitterm account. You don't have to sign in first: if you aren't signed in, or your login expired, `/cloud` shows a link, a QR code and a code. Open the link, sign in or create an account, and approve the code. The dialog closes by itself and `/cloud` carries on. Esc cancels.

The login is saved where the CLI keeps it, so `gitterm login` signs the plugin in too, and the plugin's login signs in the CLI. For a self-hosted deployment, set the `serverUrl` option, or run `gitterm login --server <url>`, where `<url>` is your Gitterm API URL. You can instead set `GITTERM_API_TOKEN` (and `GITTERM_SERVER_URL`) before starting OpenCode; a token set this way or in `token` is never replaced by signing in.

Your model keys stay on your computer. In the cloud, the agent can use free models, or the models you add under **Models** in Gitterm, which we recommend. With none added, `/cloud` suggests it before creating a workspace: continue with the free models, or add one at the link it shows and choose **Check again**; the same `/cloud` carries on.

## Options

| Option                | Type     | Required                             | Default                  | What it does                                                                                                                    |
| --------------------- | -------- | ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `provider`            | object   | No                                   | Your Gitterm default     | Provider for the workspace, for example `{ "type": "e2b" }`. Must be enabled on your deployment.                                |
| `connections`         | string[] | Only for private repositories        | None                     | Saved Gitterm connections to attach, by id, name, or integration key. `"github"` picks a connection that covers the repository. |
| `name`                | string   | No                                   | The conversation title   | Workspace name.                                                                                                                 |
| `persistent`          | boolean  | No                                   | Not requested            | Requests persistent storage where the provider supports it.                                                                     |
| `serverUrl`           | string   | No                                   | Saved CLI login          | Gitterm API URL.                                                                                                                |
| `token`               | string   | No                                   | Saved CLI login          | Gitterm API token. Prefer `gitterm login` or `GITTERM_API_TOKEN`.                                                               |
| `localServerUrl`      | string   | Only for standalone OpenCode servers | Discovered automatically | Loopback URL of your local OpenCode server: `localhost`, `127.0.0.1`, or `[::1]`, with no credentials in the URL.               |
| `localServerPassword` | string   | Only if that server needs one        | None                     | Password for that local server.                                                                                                 |

`serverUrl` and `token` resolve in this order: the option, then `GITTERM_SERVER_URL` / `GITTERM_API_TOKEN`, then the saved CLI login. The server defaults to `https://api.gitterm.dev`.

## Environment variables

| Variable                                 | What it does                                  |
| ---------------------------------------- | --------------------------------------------- |
| `GITTERM_API_TOKEN`                      | Gitterm API token. Overrides the saved login. |
| `GITTERM_SERVER_URL`                     | Gitterm API URL. Overrides the saved login.   |
| `GITTERM_OPENCODE_LOCAL_SERVER_URL`      | Same as the `localServerUrl` option.          |
| `GITTERM_OPENCODE_LOCAL_SERVER_PASSWORD` | Same as the `localServerPassword` option.     |

Set variables before OpenCode starts.

## Commands

| Command         | What it does                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/cloud`        | Moves this session into a cloud workspace. Run again in the same session to reconnect, or to retry a move that failed. See [Move a session](/docs/workspaces/move-a-session).         |
| `/cloud-return` | Brings the session, and the cloud's commits, changes and conversation, back to this checkout, then ends the workspace. See [Bring a session back](/docs/workspaces/return-a-session). |

## In the OpenCode terminal

While a session is in the cloud, the plugin's terminal part shows a **Cloud** block in the session's sidebar and a status line above the prompt: working, needs your input, idle, paused, or deleted. It notifies you when the cloud agent finishes or needs your input. Sending a message in that session locally asks first. Status checks are marked as passive, so they don't keep the workspace from pausing when it is idle.

The desktop app gets the check before sending and both commands, but not the sidebar, status line or notifications.

## Related

- [Move a session](/docs/workspaces/move-a-session)
- [Bring a session back](/docs/workspaces/return-a-session)
- [Connections](/docs/integrations/connections)
- [Lifecycle](/docs/workspaces/lifecycle)

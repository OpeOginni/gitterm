---
title: Cloud handoff plugin reference
nav: Cloud handoff plugin
description: Install, options, environment variables, and the /cloud command of @gitterm/opencode-cloud-handoff.
---

This is the reference for `@gitterm/opencode-cloud-handoff`, the OpenCode plugin that adds the `/cloud` command: every option, environment variable, and command. Use it to look up a field. For step-by-step use, see [Move a session](/docs/workspaces/move-a-session).

Formerly part of `@gitterm/opencode-plugin`. The `sandbox_*` tools are now a separate plugin; see [Sandbox tools plugin reference](/docs/reference/sandbox-tools).

## Install

```sh
opencode plugin add @gitterm/opencode-cloud-handoff
```

This installs the plugin and adds it to your global OpenCode config. You can instead list it under `plugins` in a project's `opencode.json`, or in `~/.config/opencode/opencode.json` for all projects:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@gitterm/opencode-cloud-handoff"]
}
```

Every option is optional. To pass options, replace the string with an object. Keep your other settings and plugin entries.

```jsonc
{
  "plugins": [
    {
      "package": "@gitterm/opencode-cloud-handoff",
      "options": {
        "provider": { "type": "e2b" },
        "connections": ["github"],
      },
    },
  ],
}
```

Restart OpenCode if `/cloud` does not appear. When you load the plugin from a local path, point `package` at the package directory, not a file.

## Sign in

`/cloud` needs a Gitterm login.

```sh
npm install -g @gitterm/cli
gitterm login
```

The plugin uses the CLI's saved login. For a self-hosted deployment, run `gitterm login --server <url>`, where `<url>` is your Gitterm API URL. You can instead set `GITTERM_API_TOKEN` (and `GITTERM_SERVER_URL`) before starting OpenCode.

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

| Command  | What it does                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/cloud` | Moves this session into a new cloud workspace. Run again in the same session to reconnect. See [Move a session](/docs/workspaces/move-a-session). |

## Related

- [Move a session](/docs/workspaces/move-a-session)
- [Connections](/docs/integrations/connections)
- [Lifecycle](/docs/workspaces/lifecycle)

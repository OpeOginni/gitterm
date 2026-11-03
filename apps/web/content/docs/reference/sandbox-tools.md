---
title: Sandbox tools plugin reference
nav: Sandbox tools plugin
description: Install, options, account fields, limits, environment variables, and tools of @gitterm/opencode-sandbox-tools.
---

This is the reference for `@gitterm/opencode-sandbox-tools`, the OpenCode plugin that gives your local agent remote sandboxes: every option, account field, limit, environment variable, and tool. Use it to look up a field. For step-by-step setup, see [Sandbox setup](/docs/sandboxes/setup).

Formerly part of `@gitterm/opencode-plugin`. The `/cloud` command is now a separate plugin; see [Cloud handoff plugin reference](/docs/reference/cloud-handoff).

## Install

```sh
opencode plugin add @gitterm/opencode-sandbox-tools
```

This installs the plugin and adds it to your global OpenCode config. You can instead list it under `plugins` in a project's `opencode.json`, or in `~/.config/opencode/opencode.json` for all projects.

The tools need an account, so replace the plugin's string entry with an object that has `options`. Keep your other settings and plugin entries.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@gitterm/opencode-sandbox-tools",
      "options": {
        "account": "e2b",
        "accounts": {
          "e2b": { "mode": "direct", "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
        },
      },
    },
  ],
}
```

Restart OpenCode after changing the options. When you load the plugin from a local path, point `package` at the package directory, not a file.

## Sign in

Managed accounts need a Gitterm login. Direct accounts do not.

```sh
npm install -g @gitterm/cli
gitterm login
```

The plugin uses the CLI's saved login. For a self-hosted deployment, run `gitterm login --server <url>`, where `<url>` is your Gitterm API URL. You can instead set `GITTERM_API_TOKEN` (and `GITTERM_SERVER_URL`) before starting OpenCode.

## Options

These go directly in the plugin's `options`. Without `accounts`, the tools report that sandboxes are not configured.

| Option           | Type     | Required | Default               | What it does                                                                                                                                                                                                                |
| ---------------- | -------- | -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`        | string   | Yes      | None                  | Name of the account the tools use.                                                                                                                                                                                          |
| `accounts`       | object   | Yes      | None                  | Map of account name to [account fields](#account-fields).                                                                                                                                                                   |
| `limits`         | object   | No       | See [limits](#limits) | Caps on what the agent can start.                                                                                                                                                                                           |
| `exclude`        | string[] | No       | None                  | Extra glob patterns `sandbox_sync` never uploads. Secret-like files are always left out.                                                                                                                                    |
| `publicPreviews` | boolean  | No       | `false`               | Creates every sandbox with public previews, without asking. Setting it is your approval. Only some providers can make a preview public; see [Previews by provider](/docs/sandboxes/jobs-and-previews#previews-by-provider). |

Account names use letters, digits, `_`, `.`, and `-`, start with a letter or digit, and are at most 63 characters.

### Account fields

| Field                        | Applies to                 | Required     | Default                 | What it does                                                                       |
| ---------------------------- | -------------------------- | ------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| `mode`                       | All                        | Yes          | None                    | `direct` or `managed`. See [Concepts](/docs/concepts#managed-and-direct-accounts). |
| `provider`                   | All                        | No           | `e2b`                   | `e2b`, `daytona`, `vercel`, `boat`, `exedev`, `railway`, or (managed only) `aws`.  |
| `apiKey`                     | Direct                     | Yes          | None                    | Provider key, as `"{env:VAR}"` or `"{file:path}"`.                                 |
| `allowUnboundedLifetime`     | Direct `exedev`, `railway` | Yes (`true`) | `false`                 | Accepts that a crashed sandbox runs until you destroy it.                          |
| `template`                   | Direct `e2b`               | No           | `base`                  | E2B template.                                                                      |
| `target`                     | Direct `daytona`           | No           | Daytona's default       | Region: `us` or `eu`.                                                              |
| `snapshot`                   | Direct `daytona`           | No           | None                    | Daytona snapshot to use instead of the default image.                              |
| `teamId`, `projectId`        | Direct `vercel`            | Yes          | None                    | Vercel team and project.                                                           |
| `runtime`                    | Direct `vercel`            | No           | `node24`                | `node24`, `node22`, or `python3.13`.                                               |
| `size`                       | Direct `boat`              | No           | Boat's default          | `small`, `default`, or `large`.                                                    |
| `image`                      | Direct `exedev`            | No           | `node:22-bookworm`      | Container image.                                                                   |
| `projectId`, `environmentId` | Direct `railway`           | Yes          | None                    | Railway project and environment.                                                   |
| `image`                      | Direct `railway`           | No           | `node:22-bookworm-slim` | Container image. Gitterm's command server runs in it.                              |
| `apiUrl`                     | Direct `railway`           | No           | Railway's API           | Railway API URL. Default: `backboard.railway.app/graphql/v2`.                      |
| `serverUrl`                  | Managed                    | No           | CLI login               | Gitterm API URL, for self-hosted deployments.                                      |
| `token`                      | Managed                    | No           | CLI login               | Gitterm API token. Prefer `gitterm login` or `GITTERM_API_TOKEN`.                  |

For what each provider does with a sandbox, see [Providers](/docs/sandboxes/providers).

### Limits

Set these under `limits`. Any field you leave out uses its default.

| Limit                    | Default | What it does                                                                                               |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `maxSandboxes`           | `2`     | Live sandboxes per account. `sandbox_create` fails at the limit.                                           |
| `maxLifetimeMinutes`     | `60`    | Longest lifetime `sandbox_create` accepts.                                                                 |
| `defaultLifetimeMinutes` | `30`    | Lifetime when the agent does not set one.                                                                  |
| `maxJobMinutes`          | `30`    | Longest job timeout. Jobs default to 10 minutes or this, whichever is less. Preview servers run this long. |

Providers also cap the lifetime: 24 hours, or 5 hours on Vercel.

## Environment variables

| Variable             | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `GITTERM_API_TOKEN`  | Gitterm API token for managed accounts. Overrides the saved login.  |
| `GITTERM_SERVER_URL` | Gitterm API URL for managed accounts. Overrides the saved login.    |
| `XDG_STATE_HOME`     | Base directory for local sandbox records. Default `~/.local/state`. |
| `XDG_CACHE_HOME`     | Base directory for downloaded artifacts. Default `~/.cache`.        |

Set variables before OpenCode starts. This includes variables you reference with `{env:VAR}` and variables you pass to jobs with `secretEnv`.

## Tools

The plugin adds nine tools. You ask in plain words and the agent picks them; their arguments are in [Tools](/docs/sandboxes/tools).

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
| `sandbox_destroy`  | Deletes a sandbox                                                 |

Which tools ask for approval, and how to pre-approve them: [Approvals](/docs/sandboxes/setup#approvals).

## Sidebar

OpenCode's right sidebar has a **Sandboxes** list with this checkout's live sandboxes, newest first. Each line shows the sandbox name and a dot for its state (green running, yellow pending or paused, red deleting), then any running jobs, preview ports, and its purpose or provider. The list refreshes every few seconds from the local sandbox records. It never calls the provider, and it is hidden when the checkout has no sandboxes.

## Related

- [Sandbox setup](/docs/sandboxes/setup)
- [Tools](/docs/sandboxes/tools)
- [Jobs and previews](/docs/sandboxes/jobs-and-previews)
- [CLI reference](/docs/reference/cli#sandboxes)

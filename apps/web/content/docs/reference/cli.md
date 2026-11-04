---
title: CLI reference
nav: CLI
description: Every command and flag of the gitterm CLI (@gitterm/cli), grouped by what it manages.
---

The `gitterm` CLI (`@gitterm/cli`) signs you in, manages your cloud workspaces, and runs commands in remote sandboxes. Inside a cloud workspace it offers a smaller set of commands for that workspace's ports. Use this page to look up a command or flag.

## Install

```sh
npm install -g @gitterm/cli
# or run it without installing
npx @gitterm/cli --help
```

## Global flags

| Flag        | Alias | What it does                                                                                   |
| ----------- | ----- | ---------------------------------------------------------------------------------------------- |
| `--help`    | `-h`  | Show help for any command                                                                      |
| `--version` | `-v`  | Show the CLI version                                                                           |
| `--json`    |       | Machine-readable output, on commands that support it. Errors are printed as JSON on stderr too |

## Account

| Command               | Flags                                                        | What it does                                                        |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `gitterm login`       | `--server`, `-s` `<url>` (default `https://api.gitterm.dev`) | Sign in with a device code: open the printed URL and enter the code |
| `gitterm logout`      |                                                              | Remove the saved login                                              |
| `gitterm auth status` | `--json`                                                     | Show the signed-in account, plan, and server                        |

`gitterm login` saves the login in `~/.config/gitterm/cli.json`. The SDK and the OpenCode plugins use the same file. The login is a revocable `gt_...` API token, listed under **API tokens** in the dashboard.

For a self-hosted deployment, pass its API URL. Behind the bundled path-routing proxy, that is the `/api` path:

```sh
gitterm login --server https://gitterm.example.com/api
```

## Workspaces

`ws` is an alias for `workspace`. Every command accepts `--json`. `<workspaceId>` is the id that `gitterm workspace list` prints.

| Command                                     | Flags                                                                  | What it does                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `gitterm workspace list`                    | `--status <active\|all\|terminated>` (default `active`), `--limit <n>` | List your workspaces                                                                       |
| `gitterm workspace get <workspaceId>`       |                                                                        | Show one workspace                                                                         |
| `gitterm workspace pause <workspaceId>`     |                                                                        | Pause a running workspace                                                                  |
| `gitterm workspace stop <workspaceId>`      |                                                                        | Alias for `pause`                                                                          |
| `gitterm workspace restart <workspaceId>`   |                                                                        | Resume a paused workspace                                                                  |
| `gitterm workspace terminate <workspaceId>` | `--yes`, `-y`                                                          | Terminate for good. Asks first unless you pass `--yes`. With `--json`, `--yes` is required |

The CLI does not create workspaces. Use the dashboard, the SDK, or `/cloud`. See [Cloud workspaces](/docs/workspaces/overview#ways-to-create-one).

## Sandboxes

`sb` is an alias for `sandbox`. Every command accepts `--json`, and `--account <name>` to use an account other than the selected one. For what sandboxes are and how to set up accounts, see [Sandbox setup](/docs/sandboxes/setup).

| Command                                                 | Flags                                                                        | What it does                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitterm sandbox account`                               |                                                                              | Show the selected mode, account, and who is charged                                                                                                             |
| `gitterm sandbox create`                                | `--name`, `--lifetime <minutes>` (default 30), `--public`, `--yes`/`-y`      | Create a billable sandbox. `--public` makes every preview public and can't be changed later. `--public` or `--no-public` overrides the `publicPreviews` setting |
| `gitterm sandbox list`                                  |                                                                              | List live sandboxes for the account                                                                                                                             |
| `gitterm sandbox sync <sandboxId>`                      | `--dir <path>` (default: current directory), `--yes`/`-y`                    | Upload the checkout, including uncommitted changes                                                                                                              |
| `gitterm sandbox exec <sandboxId> <command>`            | `--cwd`, `--timeout <minutes>` (default 10), `--wait <seconds>` (default 60) | Run a command as a durable job                                                                                                                                  |
| `gitterm sandbox job <sandboxId> <jobId>`               | `--offset`, `--limit`, `--wait <seconds>`                                    | Show a job's status and output                                                                                                                                  |
| `gitterm sandbox cancel <sandboxId> <jobId>`            |                                                                              | Cancel a running job                                                                                                                                            |
| `gitterm sandbox preview <sandboxId> <port>`            | `--command <cmd>`, `--serve`                                                 | Wait for a port to answer and print its URL. `--command` starts a server first. `--serve` serves a private preview on a local URL until Ctrl-C                  |
| `gitterm sandbox artifact <sandboxId> <jobId> <path>`   |                                                                              | Download a file a job produced into a local staging directory                                                                                                   |
| `gitterm sandbox apply <sandboxId> <artifact> <target>` | `--yes`/`-y`                                                                 | Copy a downloaded artifact into its job's checkout. Refuses if the target changed since that job's snapshot                                                     |
| `gitterm sandbox resume <sandboxId>`                    |                                                                              | Resume a managed sandbox paused for inactivity                                                                                                                  |
| `gitterm sandbox destroy <sandboxId>`                   |                                                                              | Delete a sandbox and confirm with the provider that it is gone                                                                                                  |

The `--lifetime` and `--timeout` defaults are the built-in sandbox limits; limits set in the accounts file change them.

`exec` and `job` exit with the job's exit code when it fails, or 1 when it timed out or was cancelled, so scripts and CI see the failure.

`create`, `sync` and `apply` ask for approval. Pass `--yes` to approve without a prompt; with `--json` you must.

The CLI reads accounts from `~/.config/gitterm/sandbox.json`, or from the file in `GITTERM_SANDBOX_CONFIG`. The file holds account names and the names of environment variables, never keys:

```json
{
  "account": "e2b",
  "accounts": {
    "e2b": { "mode": "direct", "provider": "e2b", "apiKeyEnv": "E2B_API_KEY" },
    "gitterm": { "mode": "managed" }
  }
}
```

The file takes the same `limits`, `exclude`, and `publicPreviews` settings as the [sandbox tools plugin](/docs/reference/sandbox-tools#options). With `"publicPreviews": true`, `create` makes public previews without asking. Whether a provider can make a preview public: [Previews by provider](/docs/sandboxes/jobs-and-previews#previews-by-provider).

Direct accounts don't need a Gitterm login.

## Inside a workspace

Gitterm installs the CLI in supported workspace images and gives it the workspace's own identity. When that identity is present, the CLI offers only these commands and never uses a saved user login. It can see only its own workspace.

| Command                                             | Flags                                 | What it does                                    |
| --------------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `gitterm workspace info`                            | `--json`                              | Show this workspace and its open ports          |
| `gitterm ports list`                                | `--json`                              | List open ports                                 |
| `gitterm ports open <port>`                         | `--name <name>`, `--public`, `--json` | Open a port. Private unless you pass `--public` |
| `gitterm ports visibility <port> <private\|public>` | `--json`                              | Change who can reach a port                     |
| `gitterm ports close <port>`                        | `--json`                              | Close a port                                    |

`port` is an alias for `ports`. See [Previews](/docs/workspaces/previews).

## Environment variables

| Variable                                                    | Required                      | Default                                                  | What it does                                                            |
| ----------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GITTERM_SERVER_URL`                                        | No                            | The saved login's server, then `https://api.gitterm.dev` | Gitterm API URL. Overrides the saved login                              |
| `GITTERM_API_TOKEN`                                         | No                            | The saved login's token                                  | A `gt_...` token from **API tokens**. Use it instead of `gitterm login` |
| `GITTERM_SANDBOX_CONFIG`                                    | No                            | `~/.config/gitterm/sandbox.json`                         | Path to the sandbox accounts file                                       |
| `WORKSPACE_API_URL`, `WORKSPACE_AUTH_TOKEN`, `WORKSPACE_ID` | Set by Gitterm in a workspace | None                                                     | The workspace's identity. All three must be set together                |

Environment variables win over the saved login.

## Related

- [SDK reference](/docs/reference/sdk)
- [Lifecycle](/docs/workspaces/lifecycle)
- [Sandboxes overview](/docs/sandboxes/overview)

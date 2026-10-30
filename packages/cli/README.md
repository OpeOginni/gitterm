# @gitterm/cli

Command-line interface for [GitTerm](https://gitterm.dev) to manage your cloud
workspaces from the terminal.

## Installation

```bash
# Run directly with npx
npx @gitterm/cli --help

# Or install globally
npm install -g @gitterm/cli
```

## Quick Start

```bash
# 1. Sign in (device-code flow: visit the printed URL and enter the code)
gitterm login

# 2. List your workspaces
gitterm workspace list

# 3. Manage a workspace
gitterm workspace pause <workspaceId>
gitterm workspace restart <workspaceId>
```

## Remote sandboxes

Run builds, tests, and previews in a sandbox without a remote agent. Accounts live in
`~/.config/gitterm/sandbox.json`, which holds names only. Keys come from environment
variables:

```json
{
  "account": "e2b",
  "accounts": {
    "e2b": { "mode": "direct", "provider": "e2b", "apiKeyEnv": "E2B_API_KEY" },
    "gitterm": { "mode": "managed" }
  }
}
```

```bash
gitterm sandbox account                     # selected mode, account, who is charged
gitterm sandbox create --lifetime 30
gitterm sandbox sync <id>                   # current checkout, including uncommitted changes
gitterm sandbox exec <id> "npm test" --wait 300
gitterm sandbox job <id> <jobId> --offset 0 --limit 65536
gitterm sandbox preview <id> 3000 --command "npm run dev" --serve
gitterm sandbox artifact <id> <jobId> dist/app.tar.gz
gitterm sandbox apply <id> <localPath> dist/app.tar.gz  # checked against that job's snapshot
gitterm sandbox resume <id>                # managed sandboxes paused for inactivity
gitterm sandbox destroy <id>
```

Add `--account <name>` to use another account. Direct accounts need no Gitterm login.
See [Agent sandboxes](../../docs/agent-sandboxes.md).

## Switching servers (hosted vs self-hosted)

By default the CLI talks to the hosted GitTerm API at `https://api.gitterm.dev`.
If you run your own GitTerm instance, point the CLI at that server instead.

### Option 1: Login with `--server`

```bash
# Hosted (default)
gitterm login

# Self-hosted
gitterm login --server https://gitterm.example.com

# Local development
gitterm login --server http://localhost:3000
```

The chosen URL is saved in `~/.config/gitterm/cli.json` and used by later commands.

### Option 2: Environment variables

Env vars override the saved config (useful for CI or one-off commands):

```bash
export GITTERM_SERVER_URL=https://gitterm.example.com
export GITTERM_API_TOKEN=gt_...   # from API tokens in the dashboard

gitterm auth status
gitterm workspace list
```

| Variable             | Purpose                                 |
| -------------------- | --------------------------------------- |
| `GITTERM_SERVER_URL` | API base URL (no trailing path)         |
| `GITTERM_API_TOKEN`  | `gt_...` token; skips device-code login |

Resolution order for each request: **explicit options / env vars → saved CLI config → default hosted URL** (for login only).

Check which server you are on:

```bash
gitterm auth status
# Server: http://localhost:3000
```

## Commands

| Command                                                                              | Description                       |
| ------------------------------------------------------------------------------------ | --------------------------------- |
| `gitterm login [--server <url>]`                                                     | Sign in via device-code flow      |
| `gitterm logout`                                                                     | Clear saved credentials           |
| `gitterm auth status [--json]`                                                       | Show the logged-in account        |
| `gitterm workspace list [--status <active\|all\|terminated>] [--limit <n>] [--json]` | List your workspaces              |
| `gitterm workspace get <workspaceId> [--json]`                                       | Show details for a workspace      |
| `gitterm workspace pause <workspaceId> [--json]`                                     | Pause a running workspace         |
| `gitterm workspace restart <workspaceId> [--json]`                                   | Restart a paused workspace        |
| `gitterm workspace terminate <workspaceId> [--yes] [--json]`                         | Terminate a workspace permanently |

`ws` works as a shorthand for `workspace`. All read/write commands accept `--json`
for machine-readable output (errors are emitted as JSON on stderr too), which makes
the CLI easy to drive from scripts and editor plugins.

## Authentication

`gitterm login` uses a device-code flow: it prints a verification URL and a short
code, you approve the device in your browser, and the CLI receives a user API token.

- Credentials are stored in `~/.config/gitterm/cli.json`
- The same token works with [`@gitterm/sdk`](https://www.npmjs.com/package/@gitterm/sdk)
  and other GitTerm integrations
- Create revocable tokens under **API tokens** in the dashboard
  and pass them via `GITTERM_API_TOKEN` (with optional `GITTERM_SERVER_URL`)

## Inside a GitTerm workspace

GitTerm injects a separate workspace identity and installs the CLI in supported agent
images. When those credentials are present, the CLI switches to a restricted command set:

```bash
gitterm workspace info
gitterm ports list
gitterm ports open 3000 --name app
gitterm ports open 8080 --name api --public
gitterm ports visibility 3000 public
gitterm ports close 3000
```

Ports are private by default: only your signed-in GitTerm browser session can reach the URL.
Public ports can be reached by anyone with the URL, which is what APIs and webhooks need.

No account commands are exposed in this mode. The workspace cannot list or operate on
other workspaces and cannot create a workspace. The CLI does not fall back to a saved user
login when any workspace identity variable is present.

## Programmatic use

This CLI is a thin layer over `@gitterm/sdk`. If you are building an integration,
use the SDK directly:

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient(); // reads the CLI's saved login
const { workspaces } = await client.workspaces.list();
```

## License

MIT

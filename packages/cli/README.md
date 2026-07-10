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
export GITTERM_API_TOKEN=gt_...   # from Settings → Account → API tokens

gitterm auth status
gitterm workspace list
```

| Variable             | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `GITTERM_SERVER_URL` | API base URL (no trailing path)              |
| `GITTERM_API_TOKEN`  | `gt_...` token; skips device-code login      |

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
- Create revocable tokens in the dashboard under **Settings → Account → API tokens**
  and pass them via `GITTERM_API_TOKEN` (with optional `GITTERM_SERVER_URL`)

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

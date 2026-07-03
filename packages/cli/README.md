# gitterm

Command-line interface for [GitTerm](https://gitterm.dev) to manage your cloud
workspaces from the terminal.

## Installation

```bash
# Run directly with npx
npx gitterm --help

# Or install globally
npm install -g gitterm
```

## Quick Start

```bash
# 1. Sign in (device-code flow: visit the printed URL and enter the code)
gitterm login

# 2. List your workspaces
gitterm workspace list

# 3. Manage a workspace
gitterm workspace stop <workspaceId>
gitterm workspace restart <workspaceId>
```

## Commands

| Command | Description |
| --- | --- |
| `gitterm login [--server <url>]` | Sign in via device-code flow |
| `gitterm logout` | Clear saved credentials |
| `gitterm auth status [--json]` | Show the logged-in account |
| `gitterm workspace list [--status <active\|all\|terminated>] [--limit <n>] [--json]` | List your workspaces |
| `gitterm workspace get <workspaceId> [--json]` | Show details for a workspace |
| `gitterm workspace stop <workspaceId> [--json]` | Stop a running workspace |
| `gitterm workspace restart <workspaceId> [--json]` | Restart a stopped workspace |
| `gitterm workspace terminate <workspaceId> [--yes] [--json]` | Terminate a workspace permanently |

`ws` works as a shorthand for `workspace`. All read/write commands accept `--json`
for machine-readable output (errors are emitted as JSON on stderr too), which makes
the CLI easy to drive from scripts and editor plugins.

## Authentication

`gitterm login` uses a device-code flow: it prints a verification URL and a short
code, you approve the device in your browser, and the CLI receives a user API token.

- Credentials are stored in `~/.config/gitterm/cli.json`
- The same token works with [`@gitterm/sdk`](https://www.npmjs.com/package/@gitterm/sdk)
  and other GitTerm integrations
- `GITTERM_API_TOKEN` / `GITTERM_SERVER_URL` environment variables override the
  saved config, useful with revocable tokens created in the dashboard under
  **Settings → Account → API tokens** (e.g. for CI)

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

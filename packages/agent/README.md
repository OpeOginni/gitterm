# @opeoginni/gitterm-agent

A lightweight tunnel agent that securely exposes **local development ports** through your **gitterm.dev** workspace URL.

## Installation

```bash
# Run directly with npx (recommended)
npx @opeoginni/gitterm-agent

# Or install globally
npm install -g @opeoginni/gitterm-agent
```

## Quick Start

### 1. Login to GitTerm

```bash
npx @opeoginni/gitterm-agent login
```

This will open a browser for authentication. Once logged in, your credentials are saved locally.

### 2. Connect Your Local Server

```bash
# Start your local server first
opencode serve --port 3000  # or whatever starts your server on port 3000

# Then connect it to your gitterm workspace
npx @opeoginni/gitterm-agent connect --workspace-id "your-workspace-id" --port 3000
```

That's it! Your local server is now accessible at `https://your-subdomain.gitterm.dev`.

## Commands

### `login`

Sign in via device-code flow.

```bash
npx @opeoginni/gitterm-agent login
```

### `logout`

Clear saved credentials.

```bash
npx @opeoginni/gitterm-agent logout
```

### `connect`

Connect a local port to your gitterm workspace.

```bash
npx @opeoginni/gitterm-agent connect --workspace-id <id> --port <number>
```

**Required options:**
- `--workspace-id <id>` - Your workspace ID
- `--port <number>` - Local port to expose

**Optional:**
- `--expose <name=port>` - Expose additional ports (repeatable)
- `--ws-url <url>` - Custom tunnel proxy URL (default: wss://tunnel.gitterm.dev/tunnel/connect)
- `--server-url <url>` - Custom API server URL (default: https://api.gitterm.dev)
- `--token <jwt>` - Tunnel JWT (overrides saved login)

## Examples

### Basic Usage

```bash
# Expose a local dev server
npx @opeoginni/gitterm-agent connect --workspace-id "ws_abc123" --port 3000
```

### Multiple Ports

Expose additional services as subdomains:

```bash
npx @opeoginni/gitterm-agent connect \
  --workspace-id "ws_abc123" \
  --port 3000 \
  --expose api=3001 \
  --expose docs=4000
```

This maps:
- `https://your-subdomain.gitterm.dev` -> `localhost:3000`
- `https://your-subdomain-api.gitterm.dev` -> `localhost:3001`
- `https://your-subdomain-docs.gitterm.dev` -> `localhost:4000`


## How It Works

1. The agent opens an outbound WebSocket connection to the GitTerm tunnel proxy
2. Authenticates using your saved credentials or a provided JWT
3. Proxies HTTP requests from your `*.gitterm.dev` URL to your local port
4. Supports streaming responses (SSE, WebSocket upgrades coming soon)

## Notes

- This tool does **not** start servers for you. Run your local server first, then connect.
- Credentials are stored in `~/.config/gitterm/agent.json`
- The tunnel stays open until you press Ctrl+C

## License

MIT

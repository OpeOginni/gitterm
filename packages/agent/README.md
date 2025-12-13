# @gitterm/agent

A lightweight tunnel agent that securely exposes **local development ports** through your **gitterm.dev** workspace URL.

This agent does **not** run servers for you. You run whatever you want locally (OpenCode, Next.js, Vite, ttyd, gotty, etc.), and the agent forwards requests from your `*.gitterm.dev` subdomain to your local ports.

## What this package does

- Opens an outbound WebSocket to the GitTerm tunnel proxy
- Registers your workspace tunnel using a short‑lived JWT
- Proxies HTTP requests from the public URL to `http://localhost:<port>`
- Optionally exposes multiple local services as subdomains

## Quick start

1) Start something locally, e.g. a dev server:

```bash
# example
PORT=3000 npm run dev
```

2) Get a tunnel token for your workspace (from the dashboard/API).

3) Run the agent with `npx`:

```bash
npx @gitterm/agent connect \
  --ws-url wss://tunnel.gitterm.dev/tunnel/connect \
  --token "$TUNNEL_TOKEN" \
  --port 3000
```

Now your workspace URL (e.g. `https://ws-123.gitterm.dev`) forwards to `http://localhost:3000`.

## Exposing multiple ports

Expose additional ports as named services:

```bash
npx @gitterm/agent connect \
  --ws-url wss://tunnel.gitterm.dev/tunnel/connect \
  --token "$TUNNEL_TOKEN" \
  --port 3000 \
  --expose api=3001 \
  --expose web=5173
```

This maps to:

- `https://<subdomain>.gitterm.dev` -> `localhost:3000`
- `https://<subdomain>-api.gitterm.dev` -> `localhost:3001`
- `https://<subdomain>-web.gitterm.dev` -> `localhost:5173`

Important: the server validates that exposed ports are allowlisted for your workspace.

## OpenCode workflows

These commands are currently aliases for `connect` (they do not start processes):

```bash
npx @gitterm/agent opencode --ws-url ... --token "$TUNNEL_TOKEN" --port 7681
npx @gitterm/agent opencode-web --ws-url ... --token "$TUNNEL_TOKEN" --port 3000
npx @gitterm/agent opencode-server --ws-url ... --token "$TUNNEL_TOKEN" --port 3001
```

### Using ttyd or gotty (user-hosted)

If you want a browser terminal experience, you can run something like `ttyd` or `gotty` yourself:

```bash
# ttyd example (you install & configure it yourself)
# this starts a terminal on localhost:7681

ttyd --port 7681 bash

# then tunnel that port
npx @gitterm/agent connect --ws-url ... --token "$TUNNEL_TOKEN" --port 7681
```

## Options

- `--ws-url <url>`: WebSocket URL for the tunnel proxy
- `--token <jwt>`: short-lived tunnel JWT
- `--port <number>`: primary local port (root)
- `--expose <name=port>`: extra services (repeatable)

## Notes

- Use `--help` to print usage.
- This project currently uses JSON frames over WebSocket; binary frames may be added later for performance.

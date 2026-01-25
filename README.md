![GitTerm Dashboard](./media/dashboard.png)

Run Opencode instances your way. Supports multiple cloud providers, and agentic coding paradigms such as agent loops.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic)

## What is GitTerm?

GitTerm gives you flexible ways to run Opencode instances:

1. **Cloud Workspaces** - Spin up cloud-based environments where opencode runs remotely. Access securely via browser or API.
    - **Opencode TUI (TTYD)**: use TUI on the web
    - **Opencode Server**: Get a url that can be attached on any machine with Opencode or Opencode Desktop app

2. **Local Tunnels** - Run Opencode on your local machine, then expose it through a secure tunnel, providing you a url to connect to the running Opencode Server. Also allowing you to open other port connections to test out your developments with secure public URLs.

3. **Agentic Coding Loops** - Providing a PRD document and a branch for Opencode to run wild and make commits and implement features on a loop, without having to hold its hand all through the way.

## Self-Hosting Guide

### Deploy on Railway (Recommended)

The fastest way to deploy your own GitTerm instance:

1. Click the **Deploy on Railway** button above
2. Configure the required environment variables as prompted (ADMIN_EMAIL, ADMIN_PASSWORD)
3. If you'd like subdomain division of workspaces give your `Caddy Proxy` a wildcard domain `*.your-domain.com`.
4. Setup Configurations for providers in the admin panel.

Caddy handles all routing of workspaces through a single domain.

**Self-hosted URL format:**

```bash
# Workspaces can use `/ws/` path routing or `ws-1234.your-domain.com `subdomain routing
https://your-domain.com/ws/{workspace-id}/
https://ws1234.your-domain.com
```

> **Note on Workspace routing:**  
> Path-based routing is useful if you don't have your own domain. However, it may cause issues for developed frontends that rely on relative paths (for example, asset serving), since relative paths often don't work well when served under a path as the root but do work reliably with subdomains.

### Required Services

| Service      | Purpose                       |
| ------------ | ----------------------------- |
| PostgreSQL   | Database                      |
| Redis        | Caching, pub/sub              |
| server       | Main API                      |
| web          | Frontend (dashboard, auth UI) |
| tunnel-proxy | WebSocket tunnel server       |
| proxy        | Caddy reverse proxy           |
| listener     | Webhooks (GitHub, Railway)    |
| worker       | Background jobs               |


### Worker Cron Jobs

GitTerm has two background workers that run as cron jobs, only one is needed when self hosting:

| Worker          | Recommended Schedule                | Purpose                                   |
| --------------- | ----------------------------------- | ----------------------------------------- |
| **idle-reaper** | Every 10 minutes (`*/10 * * * *`)   | Stops idle workspaces and enforces quotas |


**On Railway:** This worker can be adjusted on the dashboard

### Local Tunnels (for agents running locally)

1. **Create a workspace** with `tunnelType: "local"` via the dashboard
2. **Run the Opencode Server** on your machine using `opencode serve`
3. **Login to the CLI** specifying the url of your self hosted Gitterm server.
4. **CLI connects** to the tunnel-proxy via WebSocket
5. **Incoming requests** to your tunnel URL are routed to the `tunnel-proxy` service
6. **Tunnel-proxy multiplexes** the request over WebSocket to your local agent
7. **CLI forwards** the request to your local server and streams the response back

```bash
# Install the agent CLI
npm install -g gitterm

# Login (device code flow)
npx gitterm login -s https://your-api-domain.com

# Create a workspace with tunnelType="local" in the dashboard
# Then connect your local server
npx gitterm connect --workspace-id "workspace-id" --port 3000
```

Your local agent is now accessible through the tunnel URL.

## Development Setup

For contributors who want to run GitTerm locally.

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- [Docker](https://docker.com) (for local Postgres & Redis)
- Node.js 18+ (for some tooling)

### 1. Clone and Install

```bash
git clone https://github.com/OpeOginni/gitterm.git
cd gitterm
bun install
```

### 2. Set Up Environment Variables

```bash
# Apps
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
cp apps/tunnel-proxy/.env.example apps/tunnel-proxy/.env
cp apps/listener/.env.example apps/listener/.env
cp apps/worker/.env.example apps/worker/.env
```

### 3. Start Local Services

```bash
# Start Postgres
bun turbo db:start

# Start Redis
bun turbo redis:start
```

### 4. Set Up Database

```bash
# Migrate schema to database
bun run db:migrate
```

### 5. Run Development Servers

```bash
# Run all services
bun run dev

# Or run specific apps
bun run dev --filter=web
bun run dev --filter=server
bun run dev --filter=tunnel-proxy
```

| Service      | URL                            |
| ------------ | -------------------------------|
| Web App      | http://localhost:8888          |
| API Server   | http://localhost:8888/api      |
| Tunnel Proxy | http://localhost:8888/tunnel   |
| Listener     | http://localhost:8888/listener |
| Workspaces   | http://localhost:8888/ws/{id}  |

We make use of Caddy to streamline the whole services each connected to the 9000 port by some path

## Project Structure

```
gitterm/
├── apps/
│   ├── web/              # Next.js frontend (dashboard, auth UI)
│   ├── server/           # Main API server (Hono + tRPC)
│   ├── listener/         # Webhook listener (GitHub, Railway events)
│   ├── tunnel-proxy/     # WebSocket tunnel proxy for local tunnels
│   ├── proxy/        # Caddy configuration for routing
│   └── worker/           # Background jobs (cleanup, daily reset)
│
├── packages/
│   ├── cli/              # CLI tool ([gitterm](https://www.npmjs.com/package/gitterm))
│   ├── api/              # Shared API logic, routers, services
│   ├── auth/             # Authentication (Better Auth)
│   ├── db/               # Database schema & migrations (Drizzle + Postgres)
│   ├── redis/            # Redis repositories (tunnels, and cli auth)
│   ├── schema/           # Shared Zod schemas
│   └── env/              # configure environment variables for services
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: Next.js, TailwindCSS, shadcn/ui
- **Backend**: Hono, tRPC
- **Database**: PostgreSQL + Drizzle ORM
- **Cache/Pub-Sub**: Redis
- **Auth**: Better Auth (GitHub OAuth)
- **Monorepo**: Turborepo
- **Proxy**: Caddy
- **Deployment**: Railway

## Available Scripts

```bash
bun run dev           # Start all apps in development mode
bun run build         # Build all apps
bun run check-types   # TypeScript type checking
bun run db:push       # Push schema changes to database
bun run db:studio     # Open Drizzle Studio (database UI)
bun run db:generate   # Generate migrations
bun run db:migrate    # Run migrations
```

## Contributing

Contributions are welcome! Please read the development setup section above.

## License

This project is licensed under the **MIT License**.

See [LICENSE](LICENSE) for the full text.

## Links

- [Website](https://gitterm.dev) - Managed service
- [OpenCode](https://opencode.ai) - AI coding agent
- [Agent NPM Package](https://www.npmjs.com/package/@opeoginni/gitterm-agent)
- [GitHub](https://github.com/OpeOginni/gitterm)

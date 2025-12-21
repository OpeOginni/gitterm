# GitTerm

A cloud development environment platform with local tunnel support. Expose your local development servers through secure `*.gitterm.dev` subdomains.

## What is GitTerm?

GitTerm provides two ways to access development environments:

1. **Cloud Workspaces** - Spin up cloud-based development environments accessible via browser
2. **Local Tunnels** - Expose your local development server to the internet through a secure tunnel (like ngrok, but integrated with your workspace)

## Quick Start: Local Tunnels

Expose your local development server in seconds:

```bash
# Install and login
npx @opeoginni/gitterm-agent login

# Connect your local server (e.g., running on port 3000)
npx @opeoginni/gitterm-agent connect --workspace-id "your-workspace-id" --port 3000
```

Your local server is now accessible at `https://your-subdomain.gitterm.dev`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Caddy Proxy                             │
│                    (*.gitterm.dev routing)                      │
└──────────────┬────────────────────────────┬─────────────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────┐      ┌──────────────────────────────────┐
│    Cloud Workspaces  │      │         Tunnel Proxy             │
│  (Railway containers)│      │   (WebSocket multiplexing)       │
└──────────────────────┘      └──────────────┬───────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────────┐
                              │      gitterm-agent (CLI)         │
                              │   (runs on your local machine)   │
                              └──────────────────────────────────┘
```

## Project Structure

```
gitterm/
├── apps/
│   ├── web/              # Next.js frontend (dashboard, auth UI)
│   ├── server/           # Main API server (Hono + tRPC)
│   ├── listener/         # Webhook listener (GitHub, Railway events)
│   ├── tunnel-proxy/     # WebSocket tunnel proxy for local tunnels
│   ├── new-proxy/        # Caddy configuration for routing
│   └── worker/           # Background jobs (cleanup, daily reset)
│
├── packages/
│   ├── agent/            # CLI tool (@opeoginni/gitterm-agent)
│   ├── api/              # Shared API logic, routers, services
│   ├── auth/             # Authentication (Better Auth)
│   ├── db/               # Database schema & migrations (Drizzle + Postgres)
│   ├── redis/            # Redis repositories (tunnels, rate limiting)
│   └── schema/           # Shared Zod schemas
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
- **Deployment**: Railway (Cloudflare, AWS...soon)

## Development Setup

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

Copy the example env files and fill in your values:

```bash
# Apps
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
cp apps/tunnel-proxy/.env.example apps/tunnel-proxy/.env
cp apps/listener/.env.example apps/listener/.env
cp apps/worker/.env.exanple apps/worker/.env
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
# Push schema to database
bun run db:push

# (Optional) Seed with test data
bun run db:seed
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

| Service | URL |
|---------|-----|
| Web App | http://localhost:3001 |
| API Server | http://localhost:3000 |
| Tunnel Proxy | http://localhost:9000 |

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

## How Local Tunnels Work

1. **User creates a workspace** with `tunnelType: "local"` via the dashboard
2. **User runs the agent** on their machine: `npx @opeoginni/gitterm-agent connect`
3. **Agent authenticates** via device code flow and gets a tunnel JWT
4. **Agent connects** to the tunnel-proxy via WebSocket
5. **Incoming requests** to `subdomain.gitterm.dev` are routed through Caddy to the tunnel-proxy
6. **Tunnel-proxy multiplexes** the request over WebSocket to the agent
7. **Agent forwards** the request to the local server and streams the response back

## Contributing

Contributions are welcome! Here's how to get started:


## Deploying Your Own Instance

GitTerm is designed to run on [Railway](https://railway.app). Each app has a `railway.config.json` for deployment configuration.

Key services to deploy:
1. **PostgreSQL** - Database
2. **Redis** - Caching and pub/sub
3. **server** - Main API
4. **web** - Frontend
5. **tunnel-proxy** - Local tunnel WebSocket server
6. **new-proxy** - Caddy reverse proxy (needs custom domain setup)
7. **listener** - Webhook receiver
8. **worker** - Background jobs

You'll also need:
- A domain (e.g., `gitterm.dev`) with wildcard DNS pointing to your proxy
- GitHub OAuth app for authentication
- SSL certificates (Caddy handles this automatically with Let's Encrypt)

## License

This project is licensed under the **MIT License**.

See [LICENSE](LICENSE) for the full text.

## Links

- [Website](https://gitterm.dev)
- [Agent NPM Package](https://www.npmjs.com/package/@opeoginni/gitterm-agent)

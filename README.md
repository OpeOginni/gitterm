![GitTerm](./apps/web/public/og-card/og-card.png)

Run Opencode instances your way. Supports multiple cloud providers, and agentic coding paradigms such as agent loops.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic)

## What is GitTerm?

GitTerm gives you flexible ways to run Opencode instances:

1. **Cloud Workspaces** - Spin up cloud-based environments where Opencode runs remotely. Access securely via browser or API.
    - **Opencode TUI (TTYD)**: use TUI on the web
    - **Opencode Server**: Get a url that can be attached on any machine with Opencode or Opencode Desktop app

2. **Agentic Coding Loops** - Provide a PRD and a branch for Opencode to run in a loop and ship commits without hand-holding.

## Self-Hosting Guide

### Deploy on Railway (Recommended)

The fastest way to deploy your own GitTerm instance:

1. Click the **Deploy on Railway** button above
2. Configure the required environment variables as prompted (ADMIN_EMAIL, ADMIN_PASSWORD)
3. If you'd like subdomain division of workspaces give your `Caddy Proxy` a wildcard domain `*.your-domain.com`.
4. Configure provider credentials in the admin panel (required for workspaces).

Provider configuration is driven by `packages/schema/src/provider-registry.ts`. Admins must add the required fields for each provider before users can create workspaces. Current providers include Railway, AWS, and Cloudflare Sandbox, with more cloud and sandbox providers coming soon.

### Provider Configuration (Admin Panel)

Set these per provider in the admin panel:

- **Railway**
  - Required: API URL, API Token, Project ID, Environment ID
  - Optional: Default Region, Public Railway Domains
  - Deployment Webhook: Connect your proxy url to listen to railway webhooks using the link `https://{caddy-proxy-domain}/listener/trpc/railway.handleWebhook`, and make sure to have these events accepted `Deployment Failed`, `Deployment Deploying`, `Deployment Slept`, `Deployment Deployed`.


- **Cloudflare Sandbox**
  - Required: Worker URL, Callback Secret
  - Deploy the worker with Wrangler using `packages/api/src/providers/cloudflare/agent-worker/src/index.ts`
  ```bash
  cd packages/api 
  bun run wrangler:deploy
  ```

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

| Service    | Purpose                       |
| ---------- | ----------------------------- |
| PostgreSQL | Database                      |
| Redis      | Caching, pub/sub              |
| server     | Main API                      |
| web        | Frontend (dashboard, auth UI) |
| proxy      | Caddy reverse proxy           |
| listener   | Webhooks (GitHub, Railway)    |
| worker     | Background jobs               |


### Worker Cron Jobs

GitTerm has two background workers that run as cron jobs, only one is needed when self hosting:

| Worker          | Recommended Schedule                | Purpose                                   |
| --------------- | ----------------------------------- | ----------------------------------------- |
| **idle-reaper** | Every 10 minutes (`*/10 * * * *`)   | Stops idle workspaces and enforces quotas |


**On Railway:** This worker can be adjusted on the dashboard

## Development Setup

See `CONTRIBUTING.md` for local setup, service URLs, and contribution guidelines.

## Project Structure

```
gitterm/
├── apps/
│   ├── web/              # Next.js frontend (dashboard, auth UI)
│   ├── server/           # Main API server (Hono + tRPC)
│   ├── listener/         # Webhook listener (GitHub, Railway events)
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

Contributions are welcome! Please read `CONTRIBUTING.md`.

## License

This project is licensed under the **MIT License**.

See [LICENSE](LICENSE) for the full text.

## Links

- [Website](https://gitterm.dev) - Managed service
- [OpenCode](https://opencode.ai) - AI coding agent
- [CLI NPM Package](https://www.npmjs.com/package/gitterm)
- [GitHub](https://github.com/OpeOginni/gitterm)

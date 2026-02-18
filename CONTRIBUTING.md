# Contributing to GitTerm

Thanks for your interest in contributing! This guide covers local setup, development workflow, and expectations for pull requests.

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
```

| Service    | URL                            |
| ---------- | -------------------------------|
| Web App    | http://localhost:8888          |
| API Server | http://localhost:8888/api      |
| Listener   | http://localhost:8888/listener |
| Workspaces | http://localhost:8888/ws/{id}  |

We use Caddy to route services through a single domain and path.

## Contribution Guidelines

- Create a focused PR that solves one problem at a time.
- Include tests or reproduction steps when fixing bugs.
- Keep changes aligned with existing code style and conventions.
- Add or update documentation when behavior changes.

# Contributing to GitTerm

## Run locally

Install [Bun](https://bun.sh) at the version in [`package.json`](package.json), [Node.js](https://nodejs.org) 22.12 or newer, [Docker with Compose](https://docs.docker.com/compose/install/), and [Caddy](https://caddyserver.com/docs/install).

```sh
git clone https://github.com/OpeOginni/gitterm.git
cd gitterm
bun install --frozen-lockfile

cp apps/server/.env.example apps/server/.env.development.local
cp apps/web/.env.example apps/web/.env
cp apps/proxy/.env.example apps/proxy/.env
cp apps/listener/.env.example apps/listener/.env
```

In `apps/server/.env.development.local`:

- Set `DATABASE_URL=postgresql://postgres:password@localhost:5432/gitterm` to match the local Compose database.
- Set `BETTER_AUTH_SECRET` and `ENCRYPTION_MASTER_KEY` to separate values from `openssl rand -hex 32`.
- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for your local sign-in. The password must be at least eight characters.

In `apps/listener/.env`, set `PORT=3003` to match Caddy. Copy `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `ENCRYPTION_MASTER_KEY` from the server settings so the listener can check sessions and read saved integration settings.

```sh
docker compose up -d --wait
bun run db:migrate:dev
bun run db:seed:dev
(cd apps/server && bun run db:seed-admin)
bun run build:bots
bun run dev
```

Open [localhost:8888](http://localhost:8888) and sign in with the admin credentials you set. The API and listener should respond at [/api/health](http://localhost:8888/api/health) and [/listener/health](http://localhost:8888/listener/health).

Use `bun run dev --filter=web` or `bun run dev --filter=server` to restart a single app. To stop the local database and Redis, run `docker compose stop`.

## Database changes

Edit the schema in `packages/db/src/schema`, run `bun run db:generate`, and commit the generated files in `packages/db/src/migrations`. Apply the migration locally with `bun run db:migrate:dev`. Use `bun run db:push` only on disposable databases because it skips the migration journal.

## Checks

```sh
bunx turbo -F @gitterm/move build
bun run test
bun run format:check
bun run lint
bun run check-types
```

Keep PRs focused. Include reproduction steps for bug fixes and update the docs when behavior changes.

## npm releases

If a change needs a new npm version of the CLI, SDK, agent runtime, or OpenCode
plugin, run `bun run changeset` and commit the generated note with your PR.
Include any affected packages that bundle the changed code. See the
[release runbook](docs/releases.md) for the maintainer steps.

## Provider and integration setup

- [Provider testing](docs/provider-testing.md) covers cloud smoke tests. When testing against a local server, providers need a public HTTPS URL for callbacks and webhooks.
- [Workspace connections](https://gitterm.dev/docs/workspaces/connect) covers browser and desktop access. [Previews](https://gitterm.dev/docs/workspaces/previews) explains port visibility and sharing.
- [Connections](https://gitterm.dev/docs/integrations/connections), [Google Cloud](docs/google-workload-identity.md), and [MCP and Executor](docs/mcp-integrations.md) cover credentials and integration setup. GitHub repository access is configured under **Admin → Integrations** and is separate from GitHub sign-in.

## Deployment

Use the [self-hosting guide](https://gitterm.dev/docs/self-hosting/overview) for Docker Compose or Railway, including routing and provider setup. The [configuration reference](https://gitterm.dev/docs/self-hosting/configuration) lists environment variables, migrations, and startup options.

`docker-compose.selfhost.yml` runs the full app. `docker-compose.yml` runs only PostgreSQL and Redis for local development.

If upgrading from before migration `0052`, back up PostgreSQL and terminate Cloudflare workspaces and workspaces on old provider handles first. The migration removes those records without deleting the remote machines.

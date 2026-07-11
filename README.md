![GitTerm](./apps/web/public/og-card/og-card.png)

Run your coding agent in the cloud. GitTerm runs Opencode in remote workspaces on the cloud provider or sandbox of your choice, so you can code from any device with your own model keys.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic)

## What GitTerm does

- Runs Opencode in cloud workspaces across multiple providers
- Opens the Opencode TUI in your browser through TTYD
- Gives you server-only Opencode URLs for desktop or local clients
- Exposes any workspace port behind a shareable URL, so you can preview and test your app live
- Keeps your model keys yours (bring your own keys, no markup)

## Deploy on Railway

The fastest way to self-host:

1. Click the deploy button above.
2. Set the required env vars Railway asks for, especially `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. If you want subdomain routing, give the `proxy` service a wildcard domain like `*.your-domain.com`.
4. Configure your workspace providers in the admin panel before users create workspaces.

## Services

Required services:

| Service    | Purpose                   |
| ---------- | ------------------------- |
| PostgreSQL | Database                  |
| Redis      | Cache and pub/sub         |
| server     | Main API                  |
| web        | Dashboard and auth UI     |
| proxy      | Caddy reverse proxy       |
| listener   | Webhook and event ingress |
| worker     | Background jobs           |

Worker cron jobs:

| Worker        | Schedule       | Purpose                                   |
| ------------- | -------------- | ----------------------------------------- |
| `idle-reaper` | `*/10 * * * *` | Stops idle workspaces and enforces quotas |

## Routing

Caddy can route workspaces either by path or subdomain:

```text
https://your-domain.com/ws/{workspace-subdomain}/
https://{workspace-subdomain}.your-domain.com
https://{port}-{workspace-subdomain}.your-domain.com
```

Use path routing when you do not control wildcard DNS. Use subdomain routing for apps that rely on relative asset paths.

Open a port on a running workspace to get a live, shareable URL like `https://{port}-{workspace-subdomain}.your-domain.com`. This is handy for previewing a dev server or sharing a running app while an agent works on it.

## Providers

GitTerm can run workspaces on any of these providers. Configure each one in the admin panel before users create workspaces. Click a provider for its full setup guide.

| Provider                                                         | Type    | Webhook | Setup guide                                              |
| ---------------------------------------------------------------- | ------- | ------- | -------------------------------------------------------- |
| [Railway](https://railway.com)                                   | Compute | Yes     | [Guide](packages/api/src/providers/railway/README.md)    |
| [AWS](https://aws.amazon.com/)                                   | Compute | No      | [Guide](packages/api/src/providers/aws/README.md)        |
| [E2B](https://e2b.dev/)                                          | Sandbox | Yes     | [Guide](packages/api/src/providers/e2b/README.md)        |
| [Daytona](https://daytona.io/)                                   | Sandbox | No      | [Guide](packages/api/src/providers/daytona/README.md)    |
| [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) | Sandbox | No      | [Guide](packages/api/src/providers/cloudflare/README.md) |

[![SPONSORED BY E2B FOR STARTUPS](https://img.shields.io/badge/SPONSORED%20BY-E2B%20FOR%20STARTUPS-ff8800?style=for-the-badge)](https://e2b.dev/startups)

Field definitions for every provider live in `packages/schema/src/provider-registry.ts`.

### Webhook Base URL

Providers that use webhooks send events to the GitTerm listener. The endpoint depends on how you expose GitTerm:

- Through the public proxy: `https://<your-base-domain>/listener/trpc/...`
- Directly to the listener service: `https://<listener-base-url>/trpc/...`

If your `listener` service is not public, use the proxy form. Exact endpoints are in each provider guide.

## GitHub Integration

GitHub integration is optional. It allows users to connect repositories and perform git actions from their workspaces.

Set these env vars on the `server` service:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_ID` (for login with the same GitHub App)
- `GITHUB_APP_CLIENT_SECRET` (for login with the same GitHub App)

Set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` together for repo integration. Set
`GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` if GitHub login is enabled.
A separate GitHub OAuth App is not required.

GitHub App setup:

- Callback URL: `https://<base-domain>/api/auth/callback/github`
- Setup URL: `https://<api-url>/api/github/callback`
- Webhook via proxy: `https://<your-base-domain>/listener/trpc/github.handleInstallationWebhook`
- Webhook via listener: `https://<listener-base-url>/trpc/github.handleInstallationWebhook`

## Development

See `CONTRIBUTING.md` for local setup and service URLs.

Common commands:

```bash
bun run dev
bun run build
bun run check-types
bun run db:push
bun run db:studio:dev
bun run db:generate
bun run db:migrate:dev
bun run db:seed:dev
```

## Links

- Website: https://gitterm.dev
- OpenCode: https://opencode.ai
- GitHub: https://github.com/OpeOginni/gitterm

## License

MIT. See `LICENSE`.

## Disclaimer

GitTerm is an independent project and is not affiliated with, endorsed by, or sponsored by Opencode or its maintainers. "Opencode" and any related names or marks belong to their respective owners.

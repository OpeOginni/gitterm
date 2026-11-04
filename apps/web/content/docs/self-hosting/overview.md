---
title: Self-hosting
nav: Overview
description: Deploy Gitterm on your own infrastructure with Docker Compose or Railway, choose a routing mode, enable a provider, and check that each step worked.
---

This page is for whoever deploys and runs a Gitterm instance, person or agent. It lists what you run and what you must decide first, then gives numbered deploy steps with a check after each one. Every environment variable, with whether it is required, is on [Configuration](/docs/self-hosting/configuration). How credentials are stored and how to rotate secrets is on [Security](/docs/self-hosting/security).

A self-hosted deployment has no plans, quotas or billing. Sign-in is always email and password. It serves only the app: your URL opens the dashboard (or sign-in), there is no landing page, pricing or legal pages, and docs links go to gitterm.dev.

## What you run

| Service    | Required | What it does                                                                                                           | Health check                                             |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| PostgreSQL | Yes      | Database                                                                                                               | `pg_isready`                                             |
| Redis      | Yes      | Cache and pub/sub                                                                                                      | `redis-cli ping` returns `PONG`                          |
| `server`   | Yes      | Main API. Applies migrations, seeds the catalogs and creates the admin account on every start                          | `GET /api/health` returns `{"status":"healthy"}`         |
| `web`      | Yes      | Dashboard and sign-in                                                                                                  | `GET /login` shows the sign-in form                      |
| `proxy`    | Yes      | Caddy. Serves everything from one origin: `/api` to `server`, `/listener` to `listener`, workspaces, the rest to `web` | `GET /health` returns `{"status":"UP","mode":"railway"}` |
| `listener` | Yes      | Provider and GitHub webhooks, and live workspace status for the dashboard                                              | `GET /listener/health` (through the proxy) returns `OK`  |
| `worker`   | Yes      | Pauses idle workspaces                                                                                                 | Logs `[idle-reaper] Pass completed`                      |

The `proxy` serves plain HTTP. Put TLS in front of it.

## Before you start

| You need                                    | Required                          | Why                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A public HTTPS URL for Gitterm              | Yes, to run workspaces            | Workspaces run on the provider's machines and call back to `<PUBLIC_URL>/api/trpc` to report setup and to refresh GitHub and model credentials. Provider webhooks reach the listener the same way. The CLI, SDK and OpenCode plugins only accept `https://` (or `http://` on loopback) |
| An account with at least one provider       | Yes, to run workspaces            | Gitterm doesn't run workspaces itself. See [Enable a provider](#enable-a-provider)                                                                                                                                                                                                     |
| A wildcard DNS record and certificate       | Only if you use subdomain routing | See [Routing](#routing)                                                                                                                                                                                                                                                                |
| An SMTP server or a Resend key              | No                                | Without one, emails are written to the `server` log instead of sent                                                                                                                                                                                                                    |
| A GitHub App or a fine-grained GitHub token | No                                | Only for private repositories. Configure it after deploy under **Admin → Integrations**                                                                                                                                                                                                |

On `localhost` you can sign in and configure everything, but a cloud provider can't reach your machine, so workspaces won't finish setup.

## Routing

Choose the routing mode before anyone creates a workspace. Each workspace's address is saved when it is created.

| Mode             | Workspace and port URLs                                               | You need                                                                                      | What doesn't work                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path` (default) | `<PUBLIC_URL>/ws/<workspace>/`, `<PUBLIC_URL>/ws/<port>-<workspace>/` | One DNS record and one certificate                                                            | T3 Code workspaces (creating one is rejected). OpenCode desktop pairing links and the signed-in browser link (clients use the server password instead). Some preview apps' asset paths |
| `subdomain`      | `<port>-<workspace>.<PUBLIC_HOST>`                                    | A wildcard DNS record `*.<PUBLIC_HOST>` and a wildcard certificate on whatever terminates TLS | All of these work                                                                                                                                                                      |

Use `subdomain` if you control DNS for the domain. For a wildcard certificate, use a reverse proxy that supports the ACME DNS-01 challenge, or Cloudflare. With `subdomain`, `PUBLIC_HOST` is a bare host name with no port.

`ROUTING_MODE` has to be the same on `server`, `proxy` and `web` (`NEXT_PUBLIC_ROUTING_MODE`). Docker Compose sets all three from one value.

## Deploy with Docker Compose

`docker-compose.selfhost.yml` runs all seven services from the published images. You need Docker with Compose v2, `git` and `openssl` on the host.

1. Get the Compose file and the example settings:

   ```sh
   git clone https://github.com/OpeOginni/gitterm.git
   cd gitterm
   cp .env.selfhost.example .env.selfhost
   chmod 600 .env.selfhost
   ```

   You should see `.env.selfhost` in the directory, readable only by you.

2. Generate the secrets. Run this and copy each line into `.env.selfhost`, replacing the empty value with the same name:

   ```sh
   for name in POSTGRES_PASSWORD BETTER_AUTH_SECRET WORKSPACE_JWT_SECRET INTERNAL_API_KEY ENCRYPTION_MASTER_KEY; do
     echo "$name=$(openssl rand -hex 32)"
   done
   ```

   Each value is 64 hexadecimal characters. Use hex for `POSTGRES_PASSWORD` too: Compose puts it into the database URL without escaping. Back up `ENCRYPTION_MASTER_KEY` somewhere separate from the database backups. If you lose it, the saved credentials can't be decrypted.

3. Set the address, routing mode and admin account in `.env.selfhost`:

   ```ini
   PUBLIC_URL=https://gitterm.example.com
   PUBLIC_HOST=gitterm.example.com
   ROUTING_MODE=subdomain
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<at least 8 characters>
   # Fresh install only: store new secrets in the hardened format from the start
   ENCRYPTION_WRITE_VERSION=v3
   AUTH_ENCRYPT_OAUTH_TOKENS=true
   ```

   `<angle brackets>` mark values you replace. `PUBLIC_URL` has no trailing slash. To try Gitterm on one machine, keep the defaults `PUBLIC_URL=http://localhost:8888`, `PUBLIC_HOST=localhost:8888` and `ROUTING_MODE=path`. Leave the GitHub, email and startup settings empty unless you need them; see [Configuration](/docs/self-hosting/configuration#docker-compose-settings).

4. Check that every required value is set:

   ```sh
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml config --quiet
   ```

   You should see no output. An error such as `required variable POSTGRES_PASSWORD is missing a value` names the setting to fill in.

5. Start the stack:

   ```sh
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d
   ```

   The first start can take a few minutes. If an image can't be pulled, Compose builds it from the checkout. Then check the services:

   ```sh
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
   ```

   You should see all seven services running, and `postgres`, `redis` and `server` marked `healthy`.

6. Check that the server prepared the database and created the admin:

   ```sh
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml logs server | grep -E 'entrypoint|seed-admin'
   ```

   You should see `[entrypoint] Running migrations...`, `Running seed...`, `Running admin seed...`, `[seed-admin] Created admin user: <your email>` (or `Admin user already exists` on later starts) and `[entrypoint] Starting server...`.

7. Check the routes through the proxy, from the host:

   ```sh
   curl -s http://localhost:8888/health
   curl -s http://localhost:8888/api/health
   curl -s http://localhost:8888/listener/health
   ```

   You should see `{"status":"UP","mode":"railway"}`, `{"status":"healthy"}` and `OK`. Replace `8888` if you changed `GITTERM_PORT`.

8. Put TLS in front of the proxy for any address other than `localhost`. Forward `PUBLIC_HOST` (and `*.PUBLIC_HOST` for subdomain routing) to port `GITTERM_PORT` on the host. You should see the same three responses when you run the `curl` commands against `PUBLIC_URL`.

Continue with [First sign-in](#first-sign-in).

### Upgrade

Back up the database first. Then pull the new images and recreate the services:

```sh
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml pull
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d
```

The `server` applies new migrations as it starts. You should see the `[entrypoint]` lines from step 6 again. To run a specific release, set `GITTERM_IMAGE_TAG=v<version>`. To run migrations yourself instead, see [Startup steps](/docs/self-hosting/configuration#startup-steps).

## Deploy on Railway

The Railway template deploys the same services. Its configuration lives on Railway, not in this repository, so check the variables against [Configuration](/docs/self-hosting/configuration#service-variables) after it deploys.

1. Open the [Gitterm Railway template](https://railway.com/deploy/gitterm) and deploy it to your Railway account.
2. Fill in the variables Railway asks for, including `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Generate each secret with `openssl rand -hex 32`. You should see every service build and turn healthy in the Railway project.
3. Check the `server` variables. `WORKSPACE_API_URL` must be `<your URL>/api/trpc` and `DEVICE_CODE_VERIFICATION_URI` must be `<your URL>/device`. When unset they point at gitterm.dev, which isn't your deployment.
4. For subdomain routing, add a wildcard custom domain such as `*.example.com` to the `proxy` service, and set `ROUTING_MODE=subdomain` on `server` and `proxy` and `NEXT_PUBLIC_ROUTING_MODE=subdomain` on `web`. Redeploy `web` after changing any `NEXT_PUBLIC_*` value. You should see the `proxy` domain verified in Railway.
5. Check that the worker runs as a Railway Cron job, for example on `*/10 * * * *`, with `REAP_INTERVAL_MINUTES` unset or `0` so each run does one pass and exits. You should see `[idle-reaper] Mode: run-once` in its logs.
6. Open `https://<your domain>/health`, `/api/health` and `/listener/health`. You should see the same responses as in step 7 of the Compose deploy.

## First sign-in

1. Open `<PUBLIC_URL>/login` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

   You should see the dashboard with an **Admin** group in the sidebar. If sign-in fails, check the step 6 log lines. The admin seed only creates the account: if the email already exists, it makes it an admin and leaves the password unchanged.

2. [Enable a provider](#enable-a-provider). Required before anyone can create a workspace.
3. [Set up integrations](#optional-admin-settings) if you need them. Optional.
4. Create a test workspace from the dashboard on the provider you enabled.

   You should see it reach running and open in the browser. If it stays in setup, or reports `No setup status report was received`, the provider's machine can't reach `<PUBLIC_URL>/api/trpc`.

## Enable a provider

Every provider except AWS is listed under **Admin → Cloud providers** after the first start, disabled.

1. Open **Admin → Cloud providers** and select the provider.
2. Fill in **Credentials and config** using the provider's setup guide in the table below.
3. Choose **Save settings**.
4. Turn on the **Enabled** switch. It stays off until the settings are saved.
5. If the table says the provider uses a webhook, add it in the provider's dashboard. The provider page shows the exact URL and events under **Status webhook**.

You should see the provider listed as **Configured**, without a **Disabled** label.

For AWS, use **Add a region** in the AWS section of **Admin → Cloud providers**. Each region is its own provider.

| Provider       | Webhook  | Setup guide                                                                                                  |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| E2B            | Required | [E2B](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/e2b/README.md)               |
| Railway        | Required | [Railway](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/railway/README.md)       |
| Daytona        | Optional | [Daytona](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/daytona/README.md)       |
| Boat           | Optional | [Boat](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/boat/README.md)             |
| Vercel Sandbox | No       | [Vercel](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/vercel/README.md)         |
| exe.dev        | No       | [exe.dev](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/exedev/README.md)        |
| Cloudflare     | No       | [Cloudflare](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/cloudflare/README.md) |
| AWS            | No       | [AWS](https://github.com/OpeOginni/gitterm/blob/main/packages/api/src/providers/aws/README.md)               |

Webhooks go to the listener through the proxy: `<PUBLIC_URL>/listener/trpc/<provider>.handleWebhook`.

What each provider offers to workspaces is on [Workspaces](/docs/workspaces/overview#providers). Enabled providers also back managed sandboxes for local agents; see [Sandbox providers](/docs/sandboxes/providers).

## Optional admin settings

None of these are needed for a working install.

| Page                     | What to set                                                                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin → Integrations** | **GitHub**: one mode for private repositories, a GitHub App or a shared PAT. The App form shows the Setup URL and Webhook URL to copy into your GitHub App. **Google Cloud**, **MCP servers**, **Executor**: turn on what your users need. See [Connections](/docs/integrations/connections) |
| **Admin → System**       | Idle timeout before a workspace pauses, 5 to 120 minutes. Default 30                                                                                                                                                                                                                         |
| **Admin → Agent types**  | Which agents users can pick                                                                                                                                                                                                                                                                  |
| **Admin → Images**       | Which images users can pick                                                                                                                                                                                                                                                                  |
| **Admin → Users**        | Manage accounts                                                                                                                                                                                                                                                                              |

GitLab and Bitbucket appear under **Admin → Integrations** but aren't implemented yet.

## Point clients at your deployment

The CLI, SDK, OpenCode plugins and bots use the API URL, which is `<PUBLIC_URL>/api` behind the bundled proxy:

```sh
gitterm login --server https://gitterm.example.com/api
gitterm auth status
```

You should see your account and server in the `auth status` output. See the [CLI reference](/docs/reference/cli#account).

## Verify the install

Run through this list once after deploying. Each item names the step that covers it.

1. `<PUBLIC_URL>/health`, `/api/health` and `/listener/health` respond (Compose step 7, Railway step 6).
2. The `server` log shows migrations, seed and admin seed finishing (Compose step 6).
3. You can sign in as the admin and see the **Admin** group ([First sign-in](#first-sign-in)).
4. At least one provider is **Configured** and enabled, with its webhook added if required ([Enable a provider](#enable-a-provider)).
5. A test workspace reaches running and opens in the browser.
6. The `worker` log shows `[idle-reaper] Pass completed` at least once.
7. `ENCRYPTION_MASTER_KEY` is backed up separately from the database ([Security](/docs/self-hosting/security#encryption)).

## Related

- [Configuration](/docs/self-hosting/configuration)
- [Security](/docs/self-hosting/security)
- [Connections](/docs/integrations/connections)
- [Lifecycle](/docs/workspaces/lifecycle)

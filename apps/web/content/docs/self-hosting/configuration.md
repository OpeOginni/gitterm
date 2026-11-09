---
title: Self-hosting configuration
nav: Configuration
description: Every environment variable a self-hosted Gitterm reads, whether it is required, its default, and which ones you don't need.
---

This page lists every environment variable a self-hosted Gitterm deployment reads, for whoever configures the services. Each table says whether a variable is required, its default, and what it does. With Docker Compose you only fill in `.env.selfhost` ([Docker Compose settings](#docker-compose-settings)). On Railway, or with your own orchestration, set each service directly ([Service variables](#service-variables)). Variables for the hosted gitterm.dev service are listed under [Not needed when self-hosting](#not-needed-when-self-hosting).

For the deploy steps, see [Self-hosting](/docs/self-hosting/overview).

## Generate secrets

Generate each secret separately, with a different value for each:

```sh
openssl rand -hex 32
```

This prints 64 hexadecimal characters. `ENCRYPTION_MASTER_KEY` must be exactly this format. What each secret protects and how to change it is on [Security](/docs/self-hosting/security#secrets).

## Docker Compose settings

`docker-compose.selfhost.yml` reads these from `.env.selfhost` and passes them to the right services. Compose stops with `required variable ... is missing a value` if a variable marked `Yes` is empty.

Only these names reach the containers. Adding any other variable to `.env.selfhost` has no effect unless you also add it to the service's `environment` in the Compose file.

### Address and routing

| Variable       | Required | Default | What it does                                                                                                                                             |
| -------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`   | Yes      | None    | The URL users open, for example `https://gitterm.example.com`. No trailing slash. Compose derives every API, auth, listener and device-login URL from it |
| `PUBLIC_HOST`  | Yes      | None    | The host part of `PUBLIC_URL`, with the port if the URL has one. Workspace URLs and the sign-in cookie use it. With subdomain routing, no port           |
| `GITTERM_PORT` | No       | `8888`  | Host port the `proxy` listens on                                                                                                                         |
| `ROUTING_MODE` | No       | `path`  | `path` or `subdomain`. See [Routing](/docs/self-hosting/overview#routing)                                                                                |

### Images

| Variable               | Required | Default                     | What it does                                      |
| ---------------------- | -------- | --------------------------- | ------------------------------------------------- |
| `GITTERM_IMAGE_TAG`    | No       | `latest`                    | Image release to run, for example `v<version>`    |
| `GITTERM_IMAGE_PREFIX` | No       | `ghcr.io/opeoginni/gitterm` | Registry path. Change it only for your own builds |

### Database

| Variable            | Required | Default   | What it does                                                                               |
| ------------------- | -------- | --------- | ------------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | Yes      | None      | Database password. Use a hex value: Compose puts it into the database URL without escaping |
| `POSTGRES_DB`       | No       | `gitterm` | Database name                                                                              |
| `POSTGRES_USER`     | No       | `gitterm` | Database user                                                                              |

### Secrets and encryption

| Variable                    | Required                 | Default   | What it does                                                                                                                                               |
| --------------------------- | ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`        | Yes                      | None      | Signs sign-in sessions                                                                                                                                     |
| `WORKSPACE_JWT_SECRET`      | Yes                      | None      | Signs the tokens workspaces use to call the API                                                                                                            |
| `INTERNAL_API_KEY`          | Yes                      | None      | Authenticates `proxy`, `listener` and `worker` to `server`                                                                                                 |
| `ENCRYPTION_MASTER_KEY`     | Yes                      | None      | 64 hex characters. Encrypts saved credentials                                                                                                              |
| `ENCRYPTION_MASTER_KEY_ID`  | No                       | `primary` | Name of the active key. Change it when you rotate the key                                                                                                  |
| `ENCRYPTION_MASTER_KEYS`    | Only during key rotation | Empty     | JSON object of earlier keys by id, for example `{"primary":"<old key>"}`                                                                                   |
| `ENCRYPTION_WRITE_VERSION`  | No                       | `v2`      | `v3` binds each encrypted value to its record. Fresh installs: `v3`. Existing installs: see [Hardened writes](/docs/self-hosting/security#hardened-writes) |
| `AUTH_ENCRYPT_OAUTH_TOKENS` | No                       | `false`   | `true` encrypts login OAuth tokens. Fresh installs: `true`                                                                                                 |

### Admin account

| Variable         | Required | Default | What it does                                                                                                                            |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_EMAIL`    | No       | None    | The first admin account, created when the `server` starts. If the email already exists, that user is made an admin. Set both or neither |
| `ADMIN_PASSWORD` | No       | None    | At least 8 characters. Used only when the account is created: changing it later doesn't change the password                             |

Set both to create the first admin. Without them the admin step is skipped: there is no admin, and nobody can enable a provider.

### GitHub

Set up the GitHub App, or a shared token, under **Admin → Integrations**. There are no environment variables for it. If an earlier version read `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` from the environment, save that App there once; the variables are no longer read.

### Workspace pausing

| Variable                | Required | Default | What it does                                                                                     |
| ----------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------ |
| `ENABLE_IDLE_REAPING`   | No       | `true`  | Pause workspaces after the idle timeout set in **Admin → System**                                |
| `REAP_INTERVAL_MINUTES` | No       | `10`    | Minutes between `worker` passes. Must be above `0` in Compose, where the worker loops in-process |

### Email

Optional. Without a provider, emails are written to the `server` log.

| Variable         | Required                             | Default                          | What it does                                                                                                   |
| ---------------- | ------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER` | No                                   | `auto`                           | `auto` uses SMTP if `SMTP_HOST` is set, else Resend if `RESEND_API_KEY` is set, else logs. Or `smtp`, `resend` |
| `EMAIL_FROM`     | No                                   | `GitTerm <no-reply@example.com>` | Sender address                                                                                                 |
| `RESEND_API_KEY` | Only if `EMAIL_PROVIDER=resend`      | None                             | Resend API key                                                                                                 |
| `SMTP_HOST`      | Only if `EMAIL_PROVIDER=smtp`        | None                             | SMTP server                                                                                                    |
| `SMTP_PORT`      | No                                   | `587`                            | SMTP port. `465` uses TLS, `587` uses STARTTLS                                                                 |
| `SMTP_USER`      | Only if your SMTP server needs login | None                             | SMTP user                                                                                                      |
| `SMTP_PASS`      | Only if your SMTP server needs login | None                             | SMTP password                                                                                                  |

### Startup steps

The `server` image runs three steps before it starts, every time: migrations, the catalog seed (providers, agent types, images, models), and the admin seed. Each waits for the database and takes a lock, so several replicas can start at once. A failed step stops the server from starting.

| Variable          | Required | Default | What it does                            |
| ----------------- | -------- | ------- | --------------------------------------- |
| `SKIP_MIGRATIONS` | No       | `false` | `true` skips migrations                 |
| `SKIP_SEED`       | No       | `false` | `true` skips the catalog seed           |
| `SKIP_ADMIN_SEED` | No       | `false` | `true` skips creating the admin account |

Skip them only if you run the steps yourself, for example as a release job before you roll out new servers:

```sh
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml run --rm --no-deps --entrypoint sh server \
  -c 'bun run /app/dist/scripts/migrate.mjs --prod && bun run /app/dist/scripts/seed.mjs --prod && bun run /app/dist/scripts/seed-admin.mjs'
```

## Service variables

Set these when you configure each service yourself, for example on Railway. Docker Compose sets them for you from the settings above; `Compose:` in a row says from which. Values marked Yes must be set: most fall back to gitterm.dev or `localhost` defaults that are wrong for your deployment.

Use the same value for a variable on every service that reads it.

### server

| Variable                                                                                             | Required                 | Default                               | What it does                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                           | Yes                      | `development`                         | Set `production`. It enforces the secrets and secure cookies. The published image sets it                                        |
| `DATABASE_URL`                                                                                       | Yes                      | None                                  | PostgreSQL connection URL                                                                                                        |
| `REDIS_URL`                                                                                          | Yes                      | `redis://localhost:6379`              | Redis connection URL                                                                                                             |
| `BASE_URL`                                                                                           | Yes                      | Derived from `BASE_DOMAIN`            | Public URL of the dashboard. Compose: `PUBLIC_URL`                                                                               |
| `BASE_DOMAIN`                                                                                        | Yes                      | `gitterm.dev`                         | Public host. Workspace URLs and the sign-in cookie domain. Compose: `PUBLIC_HOST`                                                |
| `CORS_ORIGIN`                                                                                        | Yes                      | None                                  | Origin trusted for sign-in. Compose: `PUBLIC_URL`                                                                                |
| `BETTER_AUTH_URL`                                                                                    | Yes                      | Derived from `BASE_DOMAIN`            | Auth base URL. Compose: `<PUBLIC_URL>/api`                                                                                       |
| `API_URL`                                                                                            | Yes                      | `https://api.<BASE_DOMAIN>`           | Public API URL. GitHub App setup links use it. Compose: `<PUBLIC_URL>/api`                                                       |
| `WORKSPACE_API_URL`                                                                                  | Yes                      | `https://api.gitterm.dev/trpc`        | API URL that workspaces call back to. Must be reachable from the provider's machines. Compose: `<PUBLIC_URL>/api/trpc`           |
| `DEVICE_CODE_VERIFICATION_URI`                                                                       | Yes                      | `https://gitterm.dev/device`          | Page the CLI sends users to for device login. Set `<PUBLIC_URL>/device`                                                          |
| `ROUTING_MODE`                                                                                       | No                       | `path`                                | `path` or `subdomain`                                                                                                            |
| `DEPLOYMENT_MODE`                                                                                    | No                       | `self-hosted`                         | Leave as `self-hosted`. `managed` is the hosted service and requires billing                                                     |
| `PORT`                                                                                               | No                       | `8080`                                | Listen port                                                                                                                      |
| `BETTER_AUTH_SECRET`                                                                                 | Yes                      | None                                  | See [Secrets and encryption](#secrets-and-encryption)                                                                            |
| `WORKSPACE_JWT_SECRET`                                                                               | Yes                      | None                                  | Same                                                                                                                             |
| `INTERNAL_API_KEY`                                                                                   | Yes                      | None                                  | Same                                                                                                                             |
| `ENCRYPTION_MASTER_KEY`                                                                              | Yes                      | None                                  | Same. Without it, saving or reading any credential fails                                                                         |
| `ENCRYPTION_MASTER_KEY_ID`                                                                           | No                       | `primary`                             | Same                                                                                                                             |
| `ENCRYPTION_MASTER_KEYS`                                                                             | Only during key rotation | None                                  | Same                                                                                                                             |
| `ENCRYPTION_WRITE_VERSION`                                                                           | No                       | `v2`                                  | Same                                                                                                                             |
| `AUTH_ENCRYPT_OAUTH_TOKENS`                                                                          | No                       | `false`                               | Same                                                                                                                             |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                                                                      | Yes                      | None                                  | See [Admin account](#admin-account)                                                                                              |
| `ENABLE_IDLE_REAPING`                                                                                | No                       | `true`                                | Same value as on the worker                                                                                                      |
| `ENABLE_USAGE_METERING`                                                                              | No                       | `false`                               | Records usage sessions per workspace. Self-hosted deployments have no quotas, so leave it off unless you want the records        |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | No                       | See [Email](#email)                   | See [Email](#email). The server's own default for `EMAIL_FROM` is `GitTerm <no-reply@gitterm.dev>`                               |
| `EMAIL_REPLY_TO`                                                                                     | No                       | None                                  | Reply-to address. Not passed by the Compose file                                                                                 |
| `SMTP_SECURE`                                                                                        | No                       | Chosen by port                        | `true` or `false` to force TLS. Not passed by the Compose file                                                                   |
| `WORKLOAD_IDENTITY_ISSUER`, `WORKLOAD_IDENTITY_PRIVATE_KEY`, `WORKLOAD_IDENTITY_KEY_ID`              | No                       | Key id `gitterm-workload-identity-v1` | Older Google Cloud setup. Generate the key under **Admin → Integrations → Google Cloud** instead; the saved one takes precedence |
| `INTERNAL_API_URL`                                                                                   | No                       | None                                  | Older name, used only when `WORKSPACE_API_URL` is unset                                                                          |
| `SKIP_MIGRATIONS`, `SKIP_SEED`, `SKIP_ADMIN_SEED`                                                    | No                       | `false`                               | See [Startup steps](#startup-steps). Read by the server image's start script                                                     |
| `DB_WAIT_TIMEOUT_MS`                                                                                 | No                       | `60000`                               | How long each startup step waits for the database. Not passed by the Compose file                                                |
| `DB_WAIT_INTERVAL_MS`                                                                                | No                       | `2000`                                | How often it retries. Not passed by the Compose file                                                                             |

### listener

| Variable                                                                                                  | Required                | Default                 | What it does                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                | Yes                     | `development`           | Set `production`. The published image sets it                                                                         |
| `SERVER_URL`                                                                                              | Yes                     | `http://localhost:3000` | Server URL including `/api`, on the private network. Compose: `http://server:8080/api`                                |
| `INTERNAL_API_KEY`                                                                                        | Yes                     | None                    | Same value as on the server                                                                                           |
| `WORKSPACE_JWT_SECRET`                                                                                    | Yes                     | None                    | Same value as on the server. The listener does not start in production without it                                     |
| `BASE_DOMAIN`                                                                                             | Yes                     | `gitterm.dev`           | Browser origins allowed to call the listener. Compose: `PUBLIC_HOST`                                                  |
| `CORS_ORIGIN`                                                                                             | No                      | None                    | Compose: `PUBLIC_URL`                                                                                                 |
| `DATABASE_URL`, `BETTER_AUTH_SECRET`                                                                      | Yes                     | None                    | Checks the dashboard's session for live status updates, and reads the GitHub App saved under **Admin → Integrations** |
| `ENCRYPTION_MASTER_KEY`, `ENCRYPTION_MASTER_KEY_ID`, `ENCRYPTION_MASTER_KEYS`, `ENCRYPTION_WRITE_VERSION` | Yes, same as the server | See server              | Decrypts the saved GitHub App webhook secret                                                                          |
| `PORT`                                                                                                    | No                      | `8080` in the image     | Listen port                                                                                                           |

> [!NOTE]
> The bundled `docker-compose.selfhost.yml` doesn't pass `DATABASE_URL` or `BETTER_AUTH_SECRET` to `listener`.

### worker

| Variable                | Required | Default                 | What it does                                                                                                                                             |
| ----------------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER_URL`            | Yes      | `http://localhost:3000` | Same as on the listener                                                                                                                                  |
| `INTERNAL_API_KEY`      | Yes      | None                    | Same value as on the server                                                                                                                              |
| `ENABLE_IDLE_REAPING`   | No       | `true`                  | Same value as on the server                                                                                                                              |
| `REAP_INTERVAL_MINUTES` | No       | `0`                     | `0` runs one pass and exits, for a cron scheduler such as Railway Cron. Above `0` loops forever with that many minutes between passes. Compose sets `10` |
| `DEPLOYMENT_MODE`       | No       | `self-hosted`           | Leave as `self-hosted`                                                                                                                                   |
| `NODE_ENV`              | No       | `development`           | `production` in the published image                                                                                                                      |

The worker calls the server's internal API and reads no credentials, so it doesn't need the database or encryption settings.

### web

The published `web` image replaces these when the container starts. If you build `web` yourself, for example with Railway's builder, they are fixed at build time: rebuild after you change one.

| Variable                      | Required | Default           | What it does                                                                                     |
| ----------------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SERVER_URL`      | Yes      | None              | API URL. Compose: `<PUBLIC_URL>/api`                                                             |
| `NEXT_PUBLIC_AUTH_URL`        | Yes      | None              | Auth URL without `/api`. Compose: `PUBLIC_URL`                                                   |
| `NEXT_PUBLIC_LISTENER_URL`    | Yes      | None              | Listener URL. Also shown as the webhook base on provider pages. Compose: `<PUBLIC_URL>/listener` |
| `NEXT_PUBLIC_BASE_DOMAIN`     | Yes      | `gitterm.dev`     | Public host, for workspace URLs. Compose: `PUBLIC_HOST`                                          |
| `NEXT_PUBLIC_ROUTING_MODE`    | No       | `path`            | Must match the server's `ROUTING_MODE`                                                           |
| `NEXT_PUBLIC_DEPLOYMENT_MODE` | No       | `self-hosted`     | Leave as `self-hosted`                                                                           |
| `PORT`, `HOSTNAME`            | No       | `8080`, `0.0.0.0` | Listen address, set in the image                                                                 |

### proxy

| Variable           | Required | Default | What it does                                                                                  |
| ------------------ | -------- | ------- | --------------------------------------------------------------------------------------------- |
| `ROUTING_MODE`     | Yes      | None    | `path` or `subdomain`. With neither, workspace routes aren't served                           |
| `BASE_DOMAIN`      | Yes      | None    | Public host, used to match `<port>-<workspace>.<BASE_DOMAIN>`. Compose: `PUBLIC_HOST`         |
| `WEB_URL`          | Yes      | None    | `host:port` of `web` on the private network, for example `web:8080`                           |
| `SERVER_URL`       | Yes      | None    | `host:port` of `server`, for example `server:8080`. No `/api`, unlike the listener and worker |
| `LISTENER_URL`     | Yes      | None    | `host:port` of `listener`, for example `listener:8080`                                        |
| `INTERNAL_API_KEY` | Yes      | None    | Same value as on the server. Sent when the proxy asks the server who may open a workspace     |

## Not needed when self-hosting

These belong to the hosted service at gitterm.dev, or to development. Leave them unset, or at the value shown.

| Variable                                                                                                                                                                    | Where       | Why you don't need it                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ENVIRONMENT`, `POLAR_STARTER_PRODUCT_ID`, `POLAR_PRO_PRODUCT_ID`, `POLAR_GROWTH_PRODUCT_ID`, `POLAR_OVERAGE_PRICE_IDS` | server      | Billing. Self-hosted deployments have no plans                                                 |
| `ENABLE_BILLING`                                                                                                                                                            | server      | Billing. Leave unset                                                                           |
| `NEXT_PUBLIC_ENABLE_BILLING`                                                                                                                                                | web         | Billing pages. Leave `false`                                                                   |
| `BILLING_PRODUCT_EVENT_RETENTION_DAYS`                                                                                                                                      | server      | Billing analytics                                                                              |
| `ENABLE_EMAIL_AUTH`, `ENABLE_GITHUB_AUTH`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`                                                                               | server      | Sign-in methods for the hosted service. Self-hosted sign-in is always email and password       |
| `NEXT_PUBLIC_ENABLE_EMAIL_AUTH`, `NEXT_PUBLIC_ENABLE_GITHUB_AUTH`                                                                                                           | web         | Same                                                                                           |
| `POSTHOG_ERROR_TRACKING_ENABLED`, `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST`                                                                                                     | server      | Error reporting. Off unless `POSTHOG_ERROR_TRACKING_ENABLED=true`                              |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_HOST`, `POSTHOG_RELEASE_VERSION`                               | web (build) | Browser analytics and source-map upload. The published image is built without them             |
| `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY`                                                                                                                                          | web         | Contact form on the gitterm.dev self-host page                                                 |
| `DISCORD_TOKEN`, `DISCORD_DM_CHANNEL_ID`                                                                                                                                    | server      | Notifications to the hosted service's owner. Not the [Discord bot](/docs/integrations/discord) |
| `ENCRYPTION_ALLOW_INSECURE_DEV_KEY`                                                                                                                                         | server      | Development only. Ignored when `NODE_ENV=production`                                           |
| `DEBUG_PROXY_RESOLVE`                                                                                                                                                       | server      | Extra logging for workspace routing                                                            |
| `DB_MIGRATIONS_DIR`                                                                                                                                                         | server      | Set by the server image                                                                        |

`DEPLOYMENT_MODE` and `NEXT_PUBLIC_DEPLOYMENT_MODE` must stay `self-hosted`. `managed` turns on billing and fails to start without the Polar settings.

## Related

- [Self-hosting](/docs/self-hosting/overview)
- [Security](/docs/self-hosting/security)

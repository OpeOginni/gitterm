---
title: Security and credential storage
nav: Security
description: What each deployment secret protects and how to change it, how a self-hosted Gitterm encrypts and hands out credentials, and how to rotate the encryption key.
---

This page is for whoever runs a self-hosted Gitterm deployment. It covers what each deployment secret protects and how to change it, how stored credentials are encrypted, what reaches a workspace, how to rotate the master key, and what revocation does. Read it before you put real credentials into the deployment. Where each variable is set is on [Configuration](/docs/self-hosting/configuration).

## Secrets

Generate every secret with `openssl rand -hex 32`, and use a different value for each. Keep them in your deployment's secret manager or a file only you can read (`chmod 600 .env.selfhost`), never in the database or source control.

| Secret                  | Set on                                  | What it protects                                                                | How to change it                                                                                                             |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_MASTER_KEY` | `server`, `listener`                    | Every credential stored in the database                                         | With overlap, see [Rotate the master key](#rotate-the-master-key). Never just replace it                                     |
| `BETTER_AUTH_SECRET`    | `server`, `listener`                    | Sign-in sessions, and login OAuth tokens once `AUTH_ENCRYPT_OAUTH_TOKENS=true`  | Set the new value everywhere and restart. Everyone has to sign in again. It is not part of the encryption keyring            |
| `WORKSPACE_JWT_SECRET`  | `server`, `listener`                    | The tokens each workspace uses to call the API. They are valid for a year       | There is no overlap. Changing it breaks every existing workspace's token, so recreate those workspaces                       |
| `INTERNAL_API_KEY`      | `server`, `proxy`, `listener`, `worker` | Calls between services, including the proxy's check of who may open a workspace | Set the new value on all four at once and restart them. Requests fail until all four match                                   |
| `POSTGRES_PASSWORD`     | `postgres`, and inside `DATABASE_URL`   | The database                                                                    | Change the user's password in PostgreSQL first. The `postgres` image reads this value only when it creates an empty database |
| `ADMIN_PASSWORD`        | `server`                                | The first admin account                                                         | Has no effect after the account exists                                                                                       |

## The boundary

An agent can read any credential its own process can use. File permissions and hidden paths prevent accidental leaks; they don't hide a usable credential from the agent. So Gitterm limits how long credentials last, what they can reach and where they are kept, rather than claiming a workspace can't see them.

## What reaches a workspace

| Credential                                                 | How it is handled                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub App token                                           | Scoped to the repositories, expires after one hour, refreshed only while the workspace runs. Kept under `/run/gitterm`, not the persistent home directory                |
| Shared GitHub token                                        | Stored encrypted. A workspace that selects it receives it under `/run/gitterm`. It is long-lived: revoke it at GitHub to cut off a running workspace                     |
| Google Cloud                                               | No Google key is stored. Workspaces get five-minute Gitterm identity tokens and exchange them through Workload Identity Federation                                       |
| Model subscriptions (ChatGPT, OpenCode Console, SuperGrok) | The refresh token stays encrypted in Gitterm. Workspaces get an access token and ask Gitterm for a new one. Only running workspaces created with that credential can ask |
| Claude Code and Codex in T3 Code                           | Receive their own refresh tokens, which Gitterm doesn't refresh centrally                                                                                                |
| MCP and Executor                                           | Headers stored encrypted per connection. Workspaces receive them as `GITTERM_MCP_*` environment variables, which the agent can read                                      |
| Secret files from the SDK                                  | Written under `/run/gitterm/secrets/<workspace>`. The path inside the repository is a link that git ignores                                                              |
| Direct sandbox keys                                        | Stay in the process that runs the plugin or CLI. Gitterm never stores them                                                                                               |

How runtime values reach the machine depends on the workspace provider. On Railway they stay encrypted in Gitterm and the workspace fetches them at boot with a revocable token. On AWS they live in a Secrets Manager secret per workspace. Sandbox providers receive them through their authenticated API.

Gitterm records when credentials are issued, without token values, headers or secret contents.

## Encryption

Each encrypted value gets its own random 256-bit data key. That key is wrapped with the deployment's AES-256-GCM master key, and the ciphertext records the key id. No KMS is needed.

```ini
ENCRYPTION_MASTER_KEY=<64 hex characters>
ENCRYPTION_MASTER_KEY_ID=primary
```

Set the same keyring on `server`, `listener`, and any job that runs migrations or the security scripts. Without a master key, saving or reading a credential fails; production never falls back to a default key.

> [!WARNING]
> Losing the master key makes stored credentials unrecoverable. Back it up separately from database backups, and never replace a key without keeping the old one under its original id.

### Hardened writes

Two settings control the format of new writes. Reads accept every format.

| Setting                     | Compatibility     | Hardened                                       |
| --------------------------- | ----------------- | ---------------------------------------------- |
| `ENCRYPTION_WRITE_VERSION`  | `v2` (default)    | `v3`: binds each value to its owner and record |
| `AUTH_ENCRYPT_OAUTH_TOKENS` | `false` (default) | `true`: encrypts login OAuth tokens            |

A fresh install can use the hardened values from the start. An existing install switches in this order:

1. Back up the database. Don't rotate any secret during the switch.
2. Deploy the current release to every service with the compatibility values, and wait for old processes to stop.
3. Set the hardened values and restart the services.
4. Run the dry runs, then apply, then dry-run again:

   ```sh
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml exec server bun run /app/dist/scripts/security-rewrap.mjs
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml exec server bun run /app/dist/scripts/security-oauth.mjs
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml exec server bun run /app/dist/scripts/security-rewrap.mjs --apply
   docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml exec server bun run /app/dist/scripts/security-oauth.mjs --apply
   ```

   Outside Compose, run `bun run /app/dist/scripts/security-rewrap.mjs` and `security-oauth.mjs` in the server container. Each run prints one JSON line. Run both dry runs again at the end: you should see `"candidates":0` and `"conflicts":0` from each. Repeat the apply step until you do.

Once hardened writes are on, only roll back to a release that can read them. Turning them off again doesn't decrypt anything and allows weaker writes.

## Rotate the master key

1. Move the current key into `ENCRYPTION_MASTER_KEYS` under its existing id.
2. Set a new `ENCRYPTION_MASTER_KEY` and a new `ENCRYPTION_MASTER_KEY_ID`:

   ```ini
   ENCRYPTION_MASTER_KEY_ID=2026-09
   ENCRYPTION_MASTER_KEY=<new key>
   ENCRYPTION_MASTER_KEYS={"primary":"<previous key>"}
   ```

3. Deploy to `server` and `listener`. New writes use the new key; reads accept both.
4. Run `security-rewrap.mjs` as above to see how many records still use the old key, then run it with `--apply`.
5. Repeat the dry run until it prints `"candidates":0` and `"conflicts":0`. Then remove the old key from the live services, and keep it separately until old backups expire.

The rewrap covers model credentials, provider configs, workspace passwords, route headers, runtime bundles, environment sets, MCP auth, SSH revocation tokens, Google issuer keys, and GitHub App keys, webhook secrets and tokens. A failed or interrupted run is safe to repeat. Don't remove a key after a run that didn't finish cleanly.

## Revocation

- Paused workspaces can't fetch runtime values or get new GitHub, Google or model credentials. Terminated workspaces and deleted integrations can't get any.
- Revoking or deleting a model credential stops every workspace from getting new access tokens for it. Tokens already issued last until they expire.
- Removing an MCP connection stops future attachments only. Workspaces that already have it keep it; revoke the credential at the MCP provider.
- Runtime values are deleted when provisioning fails and when a workspace is terminated.
- Each workspace token is checked against the workspace's state and version on every request. Bumping the version revokes all its tokens, and the workspace then has to be recreated.

## What stays your responsibility

Database TLS, disk and backup encryption, access to the servers, and retention policies are up to your deployment. Application encryption doesn't protect against someone who controls the running application.

## Related

- [Self-hosting](/docs/self-hosting/overview)
- [Configuration](/docs/self-hosting/configuration)
- [Connections](/docs/integrations/connections)
- [Sandbox security](/docs/sandboxes/security)

# Workspace credential security

## Security boundary

An agent can read any credential that its process can use. File permissions, hidden paths, and
instructions prevent accidental disclosure; they do not make a usable credential invisible to a
same-user agent. GitTerm therefore limits persistence, scope, lifetime, and issuance rather than
claiming secrets are inaccessible to an authorized workspace.

## Credential paths

- **GitHub integration:** GitHub App installation tokens are repository-scoped, expire after one
  hour, and refresh only while the workspace is running. Token and cache files live under
  `/run/gitterm`, not the persistent home directory. Admin-managed App keys and webhook secrets
  can instead be stored envelope-encrypted in the DB; the API and webhook listener both need
  the deployment encryption key. An admin-shared PAT is stored encrypted in GitTerm but is a
  long-lived bearer credential: an explicitly selected workspace receives the PAT under `/run/gitterm` to
  perform git/gh operations, and the agent can read a credential its process can use. Removing
  the deployment's PAT configuration stops brokered refresh, but revoke the PAT on GitHub to contain a running or
  previously compromised workspace.
- **Google Cloud integration:** no Google private key is stored. Five-minute GitTerm OIDC assertions
  are exchanged through Google Workload Identity Federation for the selected service account.
  The deployment's _GitTerm issuer_ private key (not a Google service-account key) can be generated
  by an admin and stored envelope-encrypted in `google_issuer_config`. Legacy env configuration
  remains a fallback until migrated; the database value takes precedence.
- **Model subscriptions (ChatGPT, OpenCode console, SuperGrok):** these providers rotate refresh
  tokens, so a copy per workspace would sign the others out. The refresh token stays encrypted in
  GitTerm. Workspaces get an access token plus a placeholder, and the `gitterm-credentials`
  OpenCode plugin calls `workspaceOps.modelCredential` for a new access token. GitTerm locks the
  credential row, refreshes at most once, and every workspace sharing the account reuses the
  result. Only running or starting workspaces that were created with the credential can ask.
  GitHub Copilot tokens do not rotate and are still refreshed inside the workspace. T3Code
  workspaces use the same OpenCode V2 plugin and managed refresh. Native Claude/Codex
  backends still receive refresh tokens and can compete with central refresh.
- **MCP and Executor:** personal connection headers are envelope-encrypted with a connection-specific
  authenticated context. Selected workspaces receive their values as `GITTERM_MCP_*` environment
  variables; OpenCode config contains environment references, not literal secrets. OpenCode connects
  directly to the endpoint: GitTerm is not a tool relay or OAuth broker. The workspace agent can
  read these values, including an Executor PAT. Executor may keep underlying service credentials
  behind its gateway, but the PAT still grants the workspace access to the gateway's allowed tools.
  Use narrowly scoped credentials and verify the gateway's actual policy and approval behavior.
- **Caller secret files:** encrypted in transit/provider storage and materialized under
  `/run/gitterm/secrets/<workspace>`. A repository path is a git-excluded symlink only.
- **Railway:** raw runtime values are envelope-encrypted in `workspace_runtime_bundle`. Railway gets
  only workspace identity, API location, and a revocable bootstrap capability. The canonical image
  fetches and exports the bundle before clone or agent startup.
- **AWS:** values remain in a per-workspace AWS Secrets Manager secret and are injected by the ECS
  execution role. Secret bytes written as files still live under `/run` rather than EFS.
- **SDK sandbox providers:** values cross the provider's authenticated sandbox API. The provider
  security registry records this explicitly so adding a provider requires a reviewed classification.

Credential issuance metadata is stored in `workspace_credential_audit`; tokens, authorization
headers, runtime bundles, and secret contents are never audit fields.

## Encryption and rotation

New encrypted values use a random 256-bit data key per record. The data key is wrapped by the active
AES-256-GCM master key, and ciphertexts carry a key ID. Legacy AES-GCM ciphertext remains readable.
Both data and key authentication tags must be the full 16 bytes. No KMS or external secret service
is required. Keep keys outside the database, out of source control, and available to every backend
process that reads credentials. Protect local environment files with `chmod 600`.

Required configuration for real credentials in development and production:

```text
ENCRYPTION_MASTER_KEY=<64 hex characters>
ENCRYPTION_MASTER_KEY_ID=primary
```

Generate a new key with `openssl rand -hex 32`. Do not replace an existing key without retaining it
under its original ID. Losing the key makes the stored secrets unrecoverable.

### Compatible rollout

Two settings control writes, not reads:

| Setting                     | Compatibility phase | Hardened writes |
| --------------------------- | ------------------- | --------------- |
| `ENCRYPTION_WRITE_VERSION`  | `v2` (default)      | `v3`            |
| `AUTH_ENCRYPT_OAUTH_TOKENS` | `false` (default)   | `true`          |

This revision reads legacy AES-GCM, v2, and record-bound v3 values. v3 binds model credentials to
their owner, record, and provider; provider configurations to their record and provider type;
environment sets to their owner, record, and agent type; workspace passwords to their owner and
workspace; route headers to their workspace and port; and SSH revocation tokens to their workspace.
Existing MCP and runtime-bundle values already have record-specific contexts. Deployment-wide
GitHub and Google keys retain their separate authenticated contexts.

New-format authentication failures never fall back to a legacy context. Legacy values remain
readable to support existing installations and backups; they do not gain record binding until
migrated. Compatibility reads cannot detect the substitution of an otherwise valid legacy value.

Better Auth always reads both plaintext and encrypted login tokens in this revision. During the
compatibility phase, account create/update hooks keep writes plaintext so older replicas can still
read them. Once all replicas run this revision, enabling encrypted writes is safe during a rolling
restart. The OAuth migration uses Better Auth's own encryption and existing authentication secret,
not `ENCRYPTION_MASTER_KEY`. It encrypts account access/refresh tokens, not password hashes, session
tokens, or ID tokens. GitHub login does not issue an ID token. Model-provider ID tokens are already
inside the encrypted model credential.

Fresh installations can enable both hardened-write settings immediately. Existing installations
must deploy the compatibility phase everywhere first, including server replicas, listeners, workers,
scheduled jobs, and migration runners that import credential code. Wait for old processes to drain
before enabling hardened writes. Do not migrate credentials automatically at application startup.

### Development setup

1. Back up the development database and its current encryption key separately.
2. In `apps/server/.env.development.local`, keep your existing `ENCRYPTION_MASTER_KEY`, key ID,
   `BETTER_AUTH_SECRET`, and `WORKSPACE_JWT_SECRET`. Start with `ENCRYPTION_WRITE_VERSION=v2` and
   `AUTH_ENCRYPT_OAUTH_TOKENS=false`. Share the encryption keyring with any other local process that
   reads credentials.
3. If there is no existing key and no saved data, generate a random key. If saved development data
   used the former zero-key fallback, see the recovery procedure below before starting the app.
4. Start the updated services. Check an existing login and credential-backed workspace.
5. Set `ENCRYPTION_WRITE_VERSION=v3` and `AUTH_ENCRYPT_OAUTH_TOKENS=true`, then restart the services.
6. Inspect and apply both migrations from the repository root:

   ```sh
   bun run security:rewrap:dev
   bun run security:oauth:dev
   bun run security:rewrap:dev -- --apply
   bun run security:oauth:dev -- --apply
   bun run security:rewrap:dev
   bun run security:oauth:dev
   ```

7. Both final dry runs must report `candidates: 0` and `conflicts: 0`. Test an existing session,
   password login, model credential use, environment-variable get/list, and workspace access.
   Users do not need to be online, reconnect accounts, or re-enter keys.

To check the migration independently of your data, run `bun run scripts/security-storage-smoke.ts`.
It requires Docker, creates its own temporary Postgres container, uses synthetic secrets, and
removes the container afterward. It never uses your `DATABASE_URL` or calls provider APIs.

### Production setup

1. Complete the development checks first. Take a database backup and verify that the matching
   encryption and Better Auth secrets are recoverable separately. Use different dev/prod secrets.
2. Keep production's current keys and IDs unchanged for this rollout. Do not rotate signing keys or
   encryption keys at the same time. Confirm `NODE_ENV=production`.
3. Deploy this revision everywhere with `ENCRYPTION_WRITE_VERSION=v2` and
   `AUTH_ENCRYPT_OAUTH_TOKENS=false`. Wait for old replicas and jobs to drain. Check health, existing
   sessions, and a credential-backed workspace. No database schema change is required by this patch.
4. Enable `ENCRYPTION_WRITE_VERSION=v3` and `AUTH_ENCRYPT_OAUTH_TOKENS=true` on the updated services,
   then redeploy/restart them. Wait for every writer to use the new settings.
5. Run the dry runs in the production server environment, inspect the counts, apply, and dry-run
   again. A source checkout configured through `apps/server/.env` can use:

   ```sh
   bun run security:rewrap:prod
   bun run security:oauth:prod
   bun run security:rewrap:prod -- --apply
   bun run security:oauth:prod -- --apply
   bun run security:rewrap:prod
   bun run security:oauth:prod
   ```

   The production server image includes the same tools without needing source or node_modules:

   ```sh
   bun run /app/dist/scripts/security-rewrap.mjs
   bun run /app/dist/scripts/security-oauth.mjs
   bun run /app/dist/scripts/security-rewrap.mjs --apply
   bun run /app/dist/scripts/security-oauth.mjs --apply
   ```

   For Docker Compose, prefix each image command with
   `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml exec server`.
   Update `.env.selfhost` for each rollout phase and recreate the services. Repeat both dry runs
   after applying; require zero candidates and conflicts.

6. Check existing sessions, model access, OAuth token refresh, workspace credentials, and environment
   get/list. Provider-side smoke checks are manual because the isolated test does not call real providers.

The migration validates decryptability and verifies each replacement before writing. Updates compare
the stored ciphertext so a concurrent refresh or edit is not overwritten. A conflict produces a nonzero
exit code and requires a rerun. An interrupted run is safe to rerun; it may have completed some updates.
Only counts and generic failures are logged. Do not remove keys on a failed or incomplete run.

After activation, rollback only to this revision or another release with v3 and encrypted-OAuth read
support. Rolling back to older code will break access to migrated credentials. Keep hardened writes
enabled; disabling them does not decrypt existing records and permits weaker new writes.

### Former development fallback

The all-zero key is no longer silently used outside tests. An explicit
`ENCRYPTION_ALLOW_INSECURE_DEV_KEY=true` permits it in development only, with a warning, for throwaway
data. Production rejects it even with that opt-in.

To preserve existing development data that used the fallback:

1. Back up the database. Find the old `ENCRYPTION_MASTER_KEY_ID`; its default was `primary`.
2. Generate a random active key and give it a different ID, for example `dev-2026-10`.
3. Add the old zero key under its original ID in `ENCRYPTION_MASTER_KEYS`. A previous default-key
   installation would use:

   ```text
   ENCRYPTION_MASTER_KEY_ID=dev-2026-10
   ENCRYPTION_MASTER_KEY=<new random 64-character hex key>
   ENCRYPTION_MASTER_KEYS={"primary":"0000000000000000000000000000000000000000000000000000000000000000"}
   ```

4. Complete the rollout and rewrap above. Remove the zero key only after successful verification.
   Data previously protected by a publicly known key must not be treated as having been confidential.

### Subsequent key rotation

Rotation procedure:

1. Move the current key into `ENCRYPTION_MASTER_KEYS` under its existing key ID.
2. Set a new `ENCRYPTION_MASTER_KEY` and change `ENCRYPTION_MASTER_KEY_ID`.
3. Deploy. New writes use the new key; reads accept both keys.
4. Run `bun run security:rewrap` to inspect the count, then
   `bun run security:rewrap -- --apply` to rewrap old records.
5. Repeat the dry run until zero candidates and conflicts remain. Remove the previous key from live
   services only after no ciphertext references it. Retain it separately for backups until they expire.

Example overlap configuration:

```text
ENCRYPTION_MASTER_KEY_ID=2026-09
ENCRYPTION_MASTER_KEY=<new key>
ENCRYPTION_MASTER_KEYS={"primary":"<previous key>"}
```

The rewrap scan covers model credentials, provider configs, workspace passwords, route headers,
runtime bundles, environment sets, MCP auth, SSH revocation tokens, Google issuer keys, and GitHub
App keys/webhook secrets/PATs. Login OAuth tokens have the separate `security:oauth` migration and
depend on the Better Auth secret. Do not retire that secret through the application keyring.

Store keys using deployment secrets or protected files outside the database. Production fails closed
when no master key is configured. Database transport TLS, disk/backup encryption, access permissions,
and deletion/retention policies remain deployment responsibilities; application encryption does not
encrypt every profile field or protect against an attacker controlling the running application.

## Revocation

- Workspace bearer tokens include `authVersion`; middleware compares it with the workspace row.
- Terminated workspaces and deleted integrations cannot issue credentials.
- Paused workspaces cannot fetch runtime bundles or mint GitHub/Google/model credentials.
- Revoking or deleting a model credential stops every workspace from getting new access tokens
  for it; tokens already issued last until they expire.
- Removing or disabling an MCP connection prevents future attachments, not existing direct
  access. Existing workspaces retain their configuration and credentials. Revoke the credential
  at the MCP provider/Executor to invalidate those copies; updates apply to newly created workspaces.
- Runtime bundles are deleted on failed provisioning and termination.
- Incrementing `workspace.authVersion` revokes all tokens for that workspace. The workspace must be
  reprovisioned because its runtime no longer has a valid identity.

The long-lived workspace token is a bootstrap capability, not a third-party credential. It remains
necessary on providers without attested workload identity so a persistent workspace can restart.
It is narrowly scoped, state/version checked on every backend request, and never passed to GitHub or
Google. Third-party credentials issued from it are short-lived.

## Deployment order

Railway's brokered bootstrap requires a matching canonical image:

1. Apply migrations through `0033_mcp_connections` before deploying the integration API.
2. Configure the encryption master key. Generate the Google workload-identity signing key in
   **Admin → Integrations** after deploying the API, or retain the legacy env key during migration.
3. Build and publish all canonical agent images from this revision; verify they contain
   `/usr/local/bin/gitterm-runtime-bootstrap` and OpenCode 2 (`@opencode/cli`). Model credentials
   are provisioned through `~/.gitterm/opencode/credentials.json`, imported into OpenCode's
   credential store by the `gitterm-credentials` plugin at startup.
4. Update image catalog entries to those images.
5. Deploy the API/server.
6. Create a Railway smoke workspace and confirm Railway variables contain
   `GITTERM_REMOTE_BOOTSTRAP` but not `AGENT_FILES_BASE64`, model keys, repository tokens, or secret
   file contents.
7. Validate pause/resume, GitHub refresh, Google ADC, setup logs, and termination cleanup.

Do not deploy the Railway control-plane change against older images: they cannot fetch the runtime
bundle and will start without the required environment.

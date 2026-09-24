# Workspace credential security

## Security boundary

An agent can read any credential that its process can use. File permissions, hidden paths, and
instructions prevent accidental disclosure; they do not make a usable credential invisible to a
same-user agent. GitTerm therefore limits persistence, scope, lifetime, and issuance rather than
claiming secrets are inaccessible to an authorized workspace.

## Credential paths

- **GitHub integration:** GitHub App installation tokens are repository-scoped, expire after one
  hour, and refresh only while the workspace is running. Token and cache files live under
  `/run/gitterm`, not the persistent home directory.
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
  workspaces run OpenCode 1.x, which has no plugin hook, so they still receive the refresh token.
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

Required production configuration:

```text
ENCRYPTION_MASTER_KEY=<64 hex characters>
ENCRYPTION_MASTER_KEY_ID=primary
```

Rotation procedure:

1. Move the current key into `ENCRYPTION_MASTER_KEYS` under its existing key ID.
2. Set a new `ENCRYPTION_MASTER_KEY` and change `ENCRYPTION_MASTER_KEY_ID`.
3. Deploy. New writes use the new key; reads accept both keys.
4. Run `bun run security:rewrap` to inspect the count, then
   `bun run security:rewrap -- --apply` to rewrap old records.
5. Remove the previous key only after no ciphertext references it.

Example overlap configuration:

```text
ENCRYPTION_MASTER_KEY_ID=2026-09
ENCRYPTION_MASTER_KEY=<new key>
ENCRYPTION_MASTER_KEYS={"primary":"<previous key>"}
```

Keep all master keys in the deployment's managed secret store. Production fails closed when no
master key is configured.

## Revocation

- Workspace bearer tokens include `authVersion`; middleware compares it with the workspace row.
- Terminated workspaces and deleted integrations cannot issue credentials.
- Paused workspaces cannot fetch runtime bundles or mint GitHub/Google/model credentials.
- Revoking or deleting a model credential stops every workspace from getting new access tokens
  for it; tokens already issued last until they expire.
- Runtime bundles are deleted on failed provisioning and termination.
- Incrementing `workspace.authVersion` revokes all tokens for that workspace. The workspace must be
  reprovisioned because its runtime no longer has a valid identity.

The long-lived workspace token is a bootstrap capability, not a third-party credential. It remains
necessary on providers without attested workload identity so a persistent workspace can restart.
It is narrowly scoped, state/version checked on every backend request, and never passed to GitHub or
Google. Third-party credentials issued from it are short-lived.

## Deployment order

Railway's brokered bootstrap requires a matching canonical image:

1. Apply migrations through `0032_glamorous_lord_tyger` before deploying the integration-policy API.
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

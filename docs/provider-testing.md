# Provider testing

GitTerm's provider test suite has three layers:

- `bun run test` runs fast provider contract and unit tests without real cloud resources.
- `bun run test:providers` runs the SDK, API, provider, workspace-scoped CLI, agent run, and account CLI against real resources.
- `bun run test:providers:direct` runs the direct SDK against provider accounts without a GitTerm server.

## Local smoke tests

Use a dedicated GitTerm staging deployment with the providers configured in its database. The runner deliberately requires an explicit server and does not fall back to the production SDK default.

When the GitTerm server runs on localhost, cloud workspaces and provider webhooks still need a public route back to it. Start the local proxy, listener, and a tunnel to the proxy, then set this server environment variable and restart the server:

```bash
WORKSPACE_API_URL=https://<tunnel-domain>/api/trpc
```

Configure webhook providers against the same tunnel:

```text
Railway: https://<tunnel-domain>/listener/trpc/railway.handleWebhook
E2B:     https://<tunnel-domain>/listener/trpc/e2b.handleWebhook
```

Before testing scoped CLI commands, publish the current `@gitterm/cli`, rebuild the Docker and E2B agent images with the `Build Agent Images` workflow, and reseed the server database so provider metadata references the current images and setup commands.

The go-to local smoke test for the hosted providers is:

```bash
GITTERM_E2E_TIMEOUT_MS=360000 GITTERM_SERVER_URL=http://localhost:3000 GITTERM_API_TOKEN=<your-token> GITTERM_E2E_REPO=https://github.com/OpeOginni/opencode-copilot-auto bun run test:providers --provider railway,e2b,daytona,vercel
```

Replace `<your-token>` with a valid GitTerm API token. The server must be running at `http://localhost:3000`, and the local proxy, listener, and tunnel requirements above still apply when cloud providers need to reach the local server.

For a staging deployment, set the same values as exports and choose the providers explicitly:

```bash
export GITTERM_SERVER_URL=https://staging-api.example.com
export GITTERM_API_TOKEN=gt_...
export GITTERM_E2E_REPO=https://github.com/octocat/Hello-World

bun run test:providers --provider e2b
bun run test:providers --provider e2b,daytona
bun run test:providers --all
```

Optional settings:

```bash
export GITTERM_E2E_AGENT=opencode
export GITTERM_E2E_MODEL=opencode/big-pickle
export GITTERM_E2E_TIMEOUT_MS=240000
export GITTERM_E2E_RUN_TIMEOUT_MS=1800000
```

Providers run sequentially to limit cost. Every workspace receives a unique idempotency key and is terminated in a `finally` block after a normal test failure. The summary reports cleanup failures separately so leaked resources are visible.

`--all` is local-only. It includes every implemented provider, including providers that are not available in GitTerm's hosted product. Do not set `CI` when running it locally.

## Direct SDK smoke tests

The direct smoke runner uses the current SDK source and real provider resources, but does not require a GitTerm server, API token, listener, proxy, tunnel, or provider webhook. Run one or more providers from your machine:

```bash
export GITTERM_E2E_REPO=https://github.com/octocat/Hello-World
export GITTERM_E2E_MODEL=opencode/big-pickle

bun run test:providers:direct --provider e2b
bun run test:providers:direct --provider railway,daytona
bun run test:providers:direct --all
```

Set credentials only for the selected providers:

```bash
# E2B
export E2B_API_KEY=e2b_...
# Optional. Defaults to standard (gitterm-opencode-server). Use large for gitterm-opencode-server-lg.
export E2B_SIZE=standard

# Daytona
export DAYTONA_API_KEY=...
export DAYTONA_TARGET=us
# Optional. Defaults to opeoginni/gitterm-opencode-server:latest, pinned to a digest.

# Vercel Sandbox
export VERCEL_API_TOKEN=...
export VERCEL_TEAM_ID=...
export VERCEL_PROJECT_ID=...

# Ascii
export ASCII_API_KEY=...

# exe.dev
export EXEDEV_API_TOKEN=...
# Token cmds must include new, ls, ssh, share, ssh-key, pause, resume, and rm.

# Railway
export RAILWAY_API_TOKEN=...
export RAILWAY_PROJECT_ID=...
export RAILWAY_ENVIRONMENT_ID=...
export RAILWAY_REGION=...
```

Optional common settings:

```bash
export GITTERM_DIRECT_E2E_PROVIDERS=e2b,daytona
export GITTERM_E2E_BRANCH=main
export GITTERM_E2E_CHECKOUT_REF=main
export GITTERM_E2E_BASE_COMMIT=<full-commit-sha>
export GITTERM_E2E_REPO_USERNAME=x-access-token
export GITTERM_E2E_REPO_TOKEN=...
export GITTERM_MODEL_API_KEY=...
export GITTERM_E2E_TIMEOUT_MS=360000
export GITTERM_E2E_RUN_TIMEOUT_MS=1800000
```

Provider image overrides are available through `DAYTONA_IMAGE`, `EXEDEV_IMAGE`, and `RAILWAY_IMAGE`. To test unpublished Railway entrypoint changes, build and push a temporary public image and set `RAILWAY_IMAGE` to that tag.

Each provider test creates a persistent workspace, verifies repository cloning and synchronous setup, round-trips the serialized workspace handle, checks runtime status, runs OpenCode and reads its messages, exercises keep-alive and pause/resume when supported, then terminates and verifies termination. Providers run sequentially to limit cost. Cleanup runs in `finally`, and the summary prints the workspace ID and any cleanup failure so leaked resources can be found.

Managed-only authentication, catalog, account CLI, and workspace-scoped CLI checks are not applicable in direct mode because there is no GitTerm control plane. The repository/setup marker and direct runtime checks replace those stages.

## Hosted GitHub Actions

Run the `Provider smoke tests` workflow manually to test the hosted GitTerm application. It runs one job each for the four hosted providers:

- Railway
- E2B
- Daytona
- Vercel

The workflow uses the protected `provider-e2e` environment. Configure these secrets there:

- `GITTERM_SERVER_URL`
- `GITTERM_API_TOKEN`
- `GITTERM_E2E_REPO`

The workflow is intentionally not triggered by pull requests. Provider credentials and paid resources must not be exposed to untrusted code. It cannot run `--all`; providers that are not offered by the hosted product are tested locally with their own configured deployment.

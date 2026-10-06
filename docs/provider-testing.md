# Provider testing

GitTerm's provider test suite has three layers:

- `bun run test` runs fast provider contract and unit tests without real cloud resources.
- `bun run test:providers` runs the SDK, API, provider, workspace-scoped CLI, agent run, Context7 MCP tools, and account CLI against real resources.
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

Before testing scoped CLI commands, publish the current `@gitterm/cli`, rebuild the Docker and E2B workspace images with the `Publish Workspace Runtime Images` workflow, and reseed the server database so provider metadata references the current images and setup commands.

The go-to local smoke test for the hosted providers is:

```bash
GITTERM_E2E_TIMEOUT_MS=360000 GITTERM_SERVER_URL=http://localhost:3000 GITTERM_API_TOKEN=<your-token> GITTERM_E2E_REPO=https://github.com/OpeOginni/opencode-copilot-auto bun run test:providers --provider railway,e2b,daytona,vercel
```

Replace `<your-token>` with a valid GitTerm API token that includes `integrations:read` and `integrations:write` as well as the workspace, run, and credential scopes needed by the smoke test. Enable the MCP integration with personal connections on the deployment. The server must be running at `http://localhost:3000`, and the local proxy, listener, and tunnel requirements above still apply when cloud providers need to reach the local server.

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
export GITTERM_E2E_MODEL=opencode/gpt-5.6-luna
export GITTERM_E2E_TIMEOUT_MS=240000
export GITTERM_E2E_RUN_TIMEOUT_MS=1800000
# Optional: attach connections returned by client.integrations.connections.list().
export GITTERM_E2E_CONNECTION_IDS=github:shared,<google-connection-id>
# Optional: test an existing Context7 connection instead of creating one.
export GITTERM_E2E_MCP_CONNECTION_ID=<copied-integration-id>
# Optional: a free Context7 key for higher limits; anonymous access is the default.
export GITTERM_E2E_CONTEXT7_API_KEY=ctx7sk_...
```

The managed provider smoke runner uses the SDK to read the enabled integration catalog and list connections. If `GITTERM_E2E_CONNECTION_IDS` is set, it verifies each selected connection with `connections.get()` and attaches it to every test workspace. Select at most one per integration and ensure the selected GitHub connection can access `GITTERM_E2E_REPO`. Leave the variable unset to test public repositories without attaching an existing integration.

Providers run sequentially to limit cost. Every workspace receives a unique idempotency key and is terminated in a `finally` block after a normal test failure. The summary reports cleanup failures separately so leaked resources are visible.

### MCP end-to-end check

By default, the provider smoke runner creates a unique personal connection to `https://mcp.context7.com/mcp` for each provider through the SDK. It checks the API-side MCP handshake/tool catalog and saved connection discovery, then attaches the connection via the workspace's `connections` input—not a hand-written OpenCode config.

To test the Context7 connection you already saved, use **Copy integration ID** on its dashboard card and pass that UUID:

```bash
bun run test:providers --provider e2b --integration-id <copied-integration-id>
```

Both `--integration-id <id>` and `--integration-id=<id>` work. Alternatively set `GITTERM_E2E_MCP_CONNECTION_ID` in `scripts/.env`; the flag takes precedence. A Context7 MCP already selected in `GITTERM_E2E_CONNECTION_IDS` is also reused as the smoke target. Conflicting explicit and attached MCP IDs fail rather than silently testing another connection. The selected ID must be a personal Context7 connection accessible to the smoke token's account on the target deployment, not a URL or the integration category `mcp`.

For a saved connection, edit it and uncheck **Use OpenCode Code Mode** before running. This smoke checks direct tool records; it fails with instructions before provisioning if Code Mode is enabled. The runner retests and attaches the exact saved ID, uses its saved authentication (not `GITTERM_E2E_CONTEXT7_API_KEY`), and never changes its settings or deletes it. Repeating the same ID across providers is safe.

Inside the workspace, the agent must call Context7's `resolve-library-id` for React and `query-docs` for a returned library ID. The runner checks completed tool parts from that exact connection, real library results, and documentation with a source URL. A success reply alone, failed tool, or rate-limit response cannot pass. It repeats both tool calls after pause/restart to verify that the attachment survives the lifecycle.

Failures report the workspace/run IDs and redacted tool error messages before cleanup. Both MCP checks are strict: there is no automatic retry to hide a post-resume transport failure. Context7 usage showing one search and one documentation fetch proves the initial pair reached the upstream server, not that the post-restart pair succeeded.

Attached MCP servers use `Connection: close` to avoid reusing HTTP sockets retained in a frozen VM across pause/resume. Resume does not disconnect MCP servers, replay tool calls, or pause compute on MCP failure. Restart/deploy the GitTerm server and create a new workspace to pick up this configuration; no E2B template rebuild is required. The post-restart MCP smoke remains strict and cleans up its disposable workspace on failure.

The temporary connection uses `codemode: false` so individual MCP calls are observable in `runs.messages()`. This tests classic Streamable HTTP and the direct-tool path; it does not certify Code Mode, OAuth, or every MCP server. Context7 allows anonymous use; `GITTERM_E2E_CONTEXT7_API_KEY` optionally exercises stored header authentication with a free-tier key. External outages or exhausted quotas fail the smoke rather than silently skip it. Cloud workspaces and model calls can still incur charges.

Only the runner's own temporary connection is removed in `finally`, including after setup or run failures. Connection cleanup failures fail the provider result without preventing workspace cleanup. Existing selected connections are never removed; saved connections only have their test status/metadata refreshed. Use the staging command above against production only when you intentionally want to provision disposable production workspaces.

The hosted smoke runner requires an active saved OpenCode Zen API key and an active saved API-key credential for at least one other model provider. It ships them to the workspace as `~/.gitterm/opencode/credentials.json`, which the `gitterm-credentials` OpenCode plugin imports when the server starts, and runs `opencode auth list` after setup to verify them through OpenCode itself. No public fallback key is used. The command output lists provider names and credential types, never secret values.

`--all` is local-only. It includes every implemented provider, including providers that are not available in GitTerm's hosted product. Do not set `CI` when running it locally.

## Agent-run content privacy

GitTerm persists run lifecycle metadata, an idempotency fingerprint, and pending-input references—not prompts, responses, tool arguments/output, generated titles, or question/permission content. Conversation history remains in the workspace's OpenCode storage. `runs.get`, `runs.messages`, and lifecycle subscriptions read content live from a running workspace; run listings and cross-replica events contain metadata only. When the workspace is paused or destroyed, responses are unavailable (`finalText: null`, empty messages/inputs). Resume restores access when the workspace data still exists. Run errors in server logs include only operation and error code.

This change does not purge legacy development rows or database backups. No data migration is included.

## Direct SDK smoke tests

The direct smoke runner uses the current SDK source and real provider resources, but does not require a GitTerm server, API token, listener, proxy, tunnel, or provider webhook. Run one or more providers from your machine:

```bash
export GITTERM_E2E_REPO=https://github.com/octocat/Hello-World
export GITTERM_E2E_MODEL=opencode/gpt-5.6-luna

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

# boat (provider key `ascii`)
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

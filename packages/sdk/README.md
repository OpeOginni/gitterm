# @gitterm/sdk

TypeScript SDK for the [GitTerm](https://gitterm.dev) API. Used by the `gitterm` CLI,
the OpenCode plugin, and any integration that needs to manage GitTerm workspaces with
a user API token.

## Direct provider mode

Direct mode runs an agent using your cloud-provider account without a Gitterm server. It intentionally omits managed billing, proxying, policy, durable run history, and automatic cleanup; your application owns workspace state and lifecycle.

All built-in compute providers use the same provisioning plan and workspace/run API:

| Provider | Direct prerequisite                                            | Persistent pause | Keep-alive |
| -------- | -------------------------------------------------------------- | ---------------- | ---------- |
| E2B      | OpenCode-compatible template                                   | Yes              | Yes        |
| Daytona  | Public Gitterm OpenCode server image by default                | Yes              | Yes        |
| Vercel   | Vercel Sandbox project                                         | Yes              | Yes        |
| Ascii    | Box API key                                                    | Yes              | Yes        |
| exe.dev  | Lifecycle token, or an existing VM with `ls,ssh,share,ssh-key` | Yes              | No         |
| Railway  | Project/environment and public service domains                 | With a volume    | No         |

AWS remains available through `createGittermClient()` and the Gitterm control plane; it is intentionally not exposed in direct mode.

Cloudflare remains available through the Gitterm control plane. Direct Cloudflare support is deferred until the OpenCode v2 Workerd runtime is stable.

```ts
import { createDirectGittermClient } from "@gitterm/sdk/direct";

const direct = createDirectGittermClient({
  provider: {
    type: "e2b",
    apiKey: process.env.E2B_API_KEY!,
    size: "standard",
  },
});

let workspace = await direct.workspaces.create({
  repo: "https://github.com/acme/project",
  lifecycle: "ephemeral",
  modelCredentials: [{ providerName: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY! }],
});

try {
  const run = await direct.runs.create({ workspace, prompt: "Review the open pull request" });
  const completed = await direct.runs.wait(run, workspace);
  console.log(completed.finalText);
} finally {
  workspace = await direct.workspaces.terminate(workspace);
}
```

`DirectWorkspace` is JSON-serializable. Persist it together with the returned `sessionId` to resume provider lifecycle and OpenCode conversation context after an application restart. The serialized workspace contains the OpenCode password and may contain provider routing tokens, so encrypt it as credential material. Custom providers can implement `DirectProviderAdapter`; use `client.provider.capabilities` rather than hard-coding lifecycle assumptions.

Every adapter receives the same normalized plan: repository/ref and optional Git credentials, agent files, model credentials, environment, setup commands, serve command, and port. Provider-specific configuration only describes how to allocate and expose compute.

Direct setup has explicit phases. `beforeAgent` blocks workspace creation, while
`afterAgent` runs in the background and can be observed with `setupStatus()` or
`waitForSetup()`:

```ts
const workspace = await direct.workspaces.create({
  repo: "https://github.com/acme/project",
  setup: {
    beforeAgent: ["npm install"],
    afterAgent: ["npm run generate"],
  },
  secretFiles: [
    {
      path: "~/.config/gcloud/service-account.json",
      content: process.env.GCP_SERVICE_ACCOUNT_JSON!,
      mode: 0o600,
    },
  ],
});

await direct.workspaces.waitForSetup(workspace);
```

To attach to an existing exe.dev VM without giving Gitterm ownership of that VM, pass
`exedev: { existingVmName: "acme-agent-machine" }` to `workspaces.create()`. Terminating
that workspace stops only its tracked agent process and does not remove the VM.

Trusted integration context can be appended to the generated global `AGENTS.md` without changing the model system prompt:

```ts
await direct.workspaces.create({
  repo: "https://github.com/acme/project",
  additionalAgentInstructions:
    "You are running as a Slack bot. Keep responses concise and suitable for a thread.",
});
```

### Provider authentication

Direct workspaces can start OpenCode provider authentication without shell access. Discover the provider's methods and select a headless or device-code OAuth method when OpenCode is running remotely:

```ts
const openai = await direct.auth.get(workspace, "openai");
const method = openai.methods.find(
  (item) => item.type === "oauth" && item.id === "chatgpt-headless",
);
if (!method || method.type !== "oauth") throw new Error("OpenAI device OAuth is unavailable");

const attempt = await direct.auth.connectOAuth({
  workspace,
  integrationId: "openai",
  methodId: method.id,
  label: "Slack bot",
});

// Present these through your application UI.
console.log(attempt.url, attempt.instructions);

if (attempt.mode === "auto") {
  await direct.auth.wait(attempt, workspace);
} else {
  await direct.auth.complete(attempt, workspace, await getCodeFromUser());
}
```

OAuth started this way is stored and refreshed by OpenCode inside the workspace. Reusing a persistent workspace avoids repeated authentication; terminating an ephemeral workspace also destroys its credential store. OpenCode does not export OAuth tokens from this flow.

Applications that own OAuth separately can keep the token bundle in encrypted storage and inject it into every new workspace instead:

```ts
const credential = await credentialStore.get(slackInstallationId);
const workspace = await direct.workspaces.create({
  lifecycle: "ephemeral",
  modelCredentials: [
    {
      type: "oauth",
      providerName: "openai",
      refreshToken: credential.refreshToken,
      accessToken: credential.accessToken,
      expiresAt: credential.expiresAt,
      accountId: credential.accountId,
    },
  ],
});

// Credentials can also be added or rotated on an existing runtime.
await direct.auth.setCredential(workspace, {
  type: "oauth",
  providerName: "openai",
  refreshToken: credential.refreshToken,
  accessToken: credential.accessToken,
  expiresAt: credential.expiresAt,
});
```

In this mode the application owns encryption, tenant scoping, refresh, and persistence. OpenCode may refresh its workspace-local copy; the direct SDK does not copy rotated tokens back into application storage. Use the Gitterm control plane when those credential-management responsibilities should be managed centrally.

## Install

```sh
bun add @gitterm/sdk
# or
npm install @gitterm/sdk
```

## Switching servers (hosted vs self-hosted)

The default API is the hosted service at `https://api.gitterm.dev`. Self-hosted
instances use the same SDK — pass your instance’s base URL as `serverUrl`.

| Deployment  | Example `serverUrl`           |
| ----------- | ----------------------------- |
| Hosted      | `https://api.gitterm.dev`     |
| Self-hosted | `https://gitterm.example.com` |
| Local dev   | `http://localhost:3000`       |

### Explicit client (recommended for apps)

```ts
import { createGittermClient } from "@gitterm/sdk";

// Hosted
const hosted = createGittermClient({
  serverUrl: "https://api.gitterm.dev",
  token: process.env.GITTERM_API_TOKEN,
});

// Self-hosted / local
const selfHosted = createGittermClient({
  serverUrl: "https://gitterm.example.com", // or http://localhost:3000
  token: process.env.GITTERM_API_TOKEN,
});
```

### Environment variables

```bash
export GITTERM_SERVER_URL=https://gitterm.example.com
export GITTERM_API_TOKEN=gt_...
```

```ts
// Picks up GITTERM_SERVER_URL + GITTERM_API_TOKEN
const client = createGittermClient();
```

### CLI saved login

If you omit both options, the SDK also reads `~/.config/gitterm/cli.json` written by
`gitterm login` / `gitterm login --server <url>`.

**Resolution order:** constructor options → `GITTERM_SERVER_URL` / `GITTERM_API_TOKEN` → CLI config file.

Create tokens in the dashboard under **Settings → Account → API tokens**, or via
`gitterm login` (device-code flow). Tokens are the same `gt_...` shape on hosted and
self-hosted.

## Usage

### With an explicit API token

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient({
  token: process.env.GITTERM_API_TOKEN,
});

const { workspaces } = await client.workspaces.list();
```

### Managed private repositories

For renewable, short-lived repository authentication, connect the GitHub App in the GitTerm
dashboard and copy its **SDK integration ID** from the Integrations page:

```ts
const { workspace, runtime } = await client.workspaces.create({
  repo: "https://github.com/acme/private-repo",
  branch: "main",
  gitIntegrationId: "your-dashboard-integration-id",
});
```

Managed workspaces can also use dashboard-managed model subscriptions while accepting an
application-owned GitHub PAT inline:

```ts
const client = createGittermClient({
  token: process.env.GITTERM_API_TOKEN,
});

const { workspace, runtime } = await client.workspaces.create({
  repo: "https://github.com/acme/private-repo",
  branch: "main",
  repositoryCredentials: {
    username: "x-access-token",
    token: process.env.GITHUB_TOKEN!,
  },
});
```

The username defaults to `x-access-token`. Inline repository credentials take precedence over
`gitIntegrationId` and authenticate repository validation, cloning, and runtime Git operations such
as pull and push. Without inline credentials, `gitIntegrationId` continues to use the connected
dashboard integration. Omitting `modelCredentialIds` and `modelCredentials` likewise continues to
use dashboard-managed model credentials.

GitTerm does not save inline PATs in its application database. Inline PATs must be delivered to the
selected compute provider and retained on the workspace machine for runtime Git operations, so
provider infrastructure and processes running in that workspace may be able to access them. Prefer
`gitIntegrationId` for durable managed workspaces and use narrowly scoped, short-lived PATs when
inline credentials are necessary.

The SDK deliberately exposes two clients. `createGittermClient()` uses a user API token and
can manage the user's workspaces. `createGittermWorkspaceClient()` uses the scoped identity
injected into a GitTerm workspace and can inspect only that workspace and its ports:

```ts
import { createGittermWorkspaceClient } from "@gitterm/sdk";

const workspace = createGittermWorkspaceClient();
const self = await workspace.self.get();
const preview = await workspace.ports.open(3000, { name: "app" });
```

The workspace client never reads the CLI's saved account login and has no create, list,
pause, restart, or terminate operations.

### With the CLI's saved login

```ts
const client = createGittermClient();
const status = await client.auth.status();
// status + client.serverUrl show which account and server you hit
```

### API

```ts
client.auth.status();                 // -> { userId, email, name, plan, authMethod }
client.workspaces.list(options?);     // -> { workspaces, pagination }
client.workspaces.get(workspaceId);
client.workspaces.getRuntimeAccess(workspaceId); // read-only; never resumes compute
client.workspaces.ensureRunning(workspaceId, options?);
client.workspaces.pause(workspaceId);
client.workspaces.restart(workspaceId);
client.workspaces.terminate(workspaceId);
client.workspaces.create({
  repo: "https://github.com/acme/product",
});
client.catalog.agentTypes();
client.catalog.cloudProviders();
client.catalog.workspaceOptions();
```

The server defaults the agent to `opencode`, selects the user's preferred provider,
uses that provider's default machine profile, and applies the provider's persistence policy.
Override only the placement decisions your integration cares about:

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  agent: "opencode",
  setup: {
    beforeAgent: ["npm install"],
    afterAgent: ["npm run generate"],
  },
  opencode: {
    skills: [
      {
        name: "release-demo",
        content: `---
name: release-demo
description: Record and publish a product release demo.
---

Follow the repository's release-demo workflow.`,
      },
    ],
    plugins: ["@acme/opencode-browser@1.2.3"],
  },
  provider: {
    type: "exedev",
    machine: { type: "profile", key: "content-rendering" },
  },
});
```

Setup commands run in order from the checked-out repository. `beforeAgent` blocks agent
startup; when it fails, `create()` rejects with the tail of its log. `afterAgent` starts
after the agent is reachable and reports status independently. Provider and agent defaults
configured by an administrator run first. Use `client.workspaces.setupStatus(workspaceId)`
or `waitForSetup(workspaceId)` to inspect the `afterAgent` phase. GitTerm persists bounded
logs and a recovery copy in the repository's git-excluded `.gitterm/setup/` directory.
Setup commands can reference the checkout with `$WORKSPACE_REPO_DIR`, which is the same on
every provider even though the underlying path differs.

Secret files are created relative to the repository with restrictive permissions and are
added to `.git/info/exclude` so the agent cannot commit them. GitTerm does not retain their
contents; to rotate a secret, recreate the workspace. Like model credentials, they are
delivered to the sandbox through its launch environment, so anyone who can read the
provider's task or container definition can read them:

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  secretFiles: [
    {
      path: ".secrets/gcp.json",
      content: process.env.GCP_SERVICE_ACCOUNT_JSON!,
      mode: "0600",
    },
  ],
  setup: {
    beforeAgent: [
      'gcloud auth activate-service-account --key-file "$WORKSPACE_REPO_DIR/.secrets/gcp.json"',
    ],
  },
});
```

`provider` is a discriminated union, so TypeScript only offers `region` for providers
where GitTerm supports caller-selected placement. Machine keys are configured by admins
and returned by `client.catalog.workspaceOptions()`; raw CPU, memory, credentials, and
provider account configuration are never supplied by SDK callers.

This makes release automation a normal workspace task: create an OpenCode workspace,
run UI review or browser capture tools in the sandbox, upload the resulting media, update
the changelog in the checked-out repository, then terminate the workspace. Use an
`idempotencyKey` based on the release SHA when the workflow may be retried.

### Agent runs

Runs use durable GitTerm IDs backed by the workspace's native OpenCode session. Reusing an
idempotency key with the same input returns the original run, and terminal results remain
available after the workspace is paused. Completion means the native session became idle;
it does not claim that a pull request, upload, or other product outcome succeeded.

```ts
const { workspace } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  setup: { afterAgent: ["npm install", "npm run db:seed"] },
});

const run = await client.runs.create({
  workspaceId: workspace.id,
  idempotencyKey: "onboarding-v2",
  waitForSetup: true,
  prompt: "Record the new onboarding flow and open a pull request adding it to the changelog.",
});

const completed = await client.runs.wait(workspace.id, run.id);
const messages = await client.runs.messages(workspace.id, run.id);
```

Runs are isolated by default and can execute in parallel. To preserve conversational context,
continue a terminal run; continued runs sharing context must remain sequential:

```ts
const next = await client.runs.create({
  workspaceId: workspace.id,
  idempotencyKey: "onboarding-tests-v1",
  prompt: "Now add tests for that change.",
  context: { type: "continue", runId: completed.id },
});
```

### Model provider credentials

Workspaces can receive model credentials two ways, and they compose:

**Dashboard credentials** — list the account's credential metadata, choose one active credential
per provider, and pass the IDs when creating a workspace. The SDK never returns credential
secrets.

```ts
const credentials = await client.credentials.list();
const selected = credentials.filter(
  (credential) =>
    credential.isActive && ["anthropic", "openai"].includes(credential.logicalProviderKey),
);

const { workspace } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  modelCredentialIds: selected.map((credential) => credential.id),
});
```

**Inline credentials** — pass API keys directly for this workspace only. They are injected into
the provisioned agent and never stored in the dashboard. Use
`client.credentials.listProviders()` for valid provider names; OAuth providers (e.g. GitHub
Copilot) can only be connected through the dashboard.

```ts
const { workspace } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  modelCredentials: [{ providerName: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY! }],
});

const run = await client.runs.create({
  workspaceId: workspace.workspaceId,
  model: "anthropic/claude-sonnet-4-20250514",
  prompt: "Record before/after videos of the changes in PR #42",
});
```

Rules and errors:

- Omit both fields to inject the dashboard defaults.
- One credential per logical provider. An inline credential always overrides the dashboard
  credential (default or selected) for the same provider; two credentials for the same provider
  within one field throw `MODEL_CREDENTIAL_DUPLICATE_PROVIDER`.
- Unknown providers or inline keys for OAuth-only providers throw `MODEL_CREDENTIAL_INVALID`;
  missing, inactive, or unowned dashboard selections throw `MODEL_CREDENTIAL_UNAVAILABLE`.
- A run that requests a credential-backed `provider/model` not available in its workspace throws
  `MODEL_CREDENTIAL_REQUIRED` before the prompt is submitted.

Use `client.runs.cancel(workspaceId, runId)` to abort the current run. GitTerm keeps the
underlying OpenCode session private. For native session control, use
`workspaces.getRuntimeAccess()` and connect with the official OpenCode SDK.

### Errors

Every method throws `GittermError` with a stable `code`:

```ts
import { GittermError } from "@gitterm/sdk";

try {
  await client.workspaces.get(id);
} catch (error) {
  if (error instanceof GittermError && error.code === "NOT_LOGGED_IN") {
    // "Not logged in. Run: gitterm login"
  }
}
```

Workspace lifecycle failures are also exposed as `WorkspaceLifecycleError`, with stable
`WORKSPACE_TERMINATED`, `WORKSPACE_NON_RECOVERABLE`, `WORKSPACE_START_TIMEOUT`, and
`WORKSPACE_RESTART_FAILED` codes. General codes are
`NOT_LOGGED_IN`, `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, `CONFLICT`,
`SERVER_ERROR`, and `NETWORK`.

The package ships self-contained declarations from `dist`; TypeScript consumers do not
need GitTerm's API package or tRPC server types.

### Obtaining a token programmatically

The device-code flow used by `gitterm login` is exposed for integrations. Pass the
server URL of the instance you want to log into:

```ts
import { loginWithDeviceCode, saveConfig, DEFAULT_GITTERM_SERVER_URL } from "@gitterm/sdk";

// Hosted: DEFAULT_GITTERM_SERVER_URL ("https://api.gitterm.dev")
// Self-hosted: "https://gitterm.example.com" or "http://localhost:3000"
const serverUrl = process.env.GITTERM_SERVER_URL ?? DEFAULT_GITTERM_SERVER_URL;

const { token } = await loginWithDeviceCode(serverUrl, {
  onCode: ({ verificationUri, userCode }) => {
    console.log(`Visit ${verificationUri} and enter ${userCode}`);
  },
});

await saveConfig({
  serverUrl,
  token,
  createdAt: Date.now(),
});
```

Device-code logins produce the same revocable `gt_...` API token as the dashboard;
they appear in **Settings → Account → API tokens** and can be revoked there.

## License

MIT

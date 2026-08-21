# @gitterm/sdk

TypeScript SDK for the [GitTerm](https://gitterm.dev) API. Used by the `gitterm` CLI,
the OpenCode plugin, and any integration that needs to manage GitTerm workspaces with
a user API token.

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
  setupCommands: ["npm install", "npm run generate"],
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

Setup commands run in order from the checked-out repository after the agent server is
ready. They do not delay workspace creation or stop the agent if they fail. Provider and
agent defaults configured by an administrator run first. Use
`client.workspaces.setupStatus(workspaceId)` or `waitForSetup(workspaceId)` to inspect them.
GitTerm persists the reported state and bounded log; a recovery copy also lives in the
repository's git-excluded `.gitterm/setup/` directory.

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
  setupCommands: ["npm install", "npm run db:seed"],
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

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
  serverUrl: "https://api.gitterm.dev",
  token: process.env.GITTERM_API_TOKEN,
});

const { workspaces } = await client.workspaces.list();
```

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
client.workspaces.createSandbox({
  idempotencyKey, repo, branch, baseCommit, checkoutRef,
  agentTypeId, cloudProviderId, persistent,
});
client.catalog.agentTypes();
client.catalog.cloudProviders();
client.catalog.resolveSandboxDefaults({ agent, provider });
```

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
`NOT_LOGGED_IN`, `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`,
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

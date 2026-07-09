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

## Usage

### With an explicit API token

Create a token in the GitTerm dashboard under **Settings → Account → API tokens**
(revocable, optional expiry), or obtain one via `gitterm login`.

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient({
  serverUrl: "https://api.gitterm.dev",
  token: process.env.GITTERM_API_TOKEN,
});

const { workspaces } = await client.workspaces.list();
```

### With the CLI's saved login

If you omit `serverUrl`/`token`, the SDK reads the config written by `gitterm login`
(`~/.config/gitterm/cli.json`), falling back to the `GITTERM_SERVER_URL` and
`GITTERM_API_TOKEN` environment variables.

```ts
const client = createGittermClient();
const status = await client.auth.status();
```

### API

```ts
client.auth.status();                 // -> { userId, email, name, plan, authMethod }
client.workspaces.list(options?);     // -> { workspaces, pagination }
client.workspaces.get(workspaceId);
client.workspaces.pause(workspaceId);
client.workspaces.restart(workspaceId);
client.workspaces.terminate(workspaceId);
client.workspaces.create(input);      // needs agentTypeId + cloudProviderId, see catalog
client.catalog.agentTypes();
client.catalog.cloudProviders();
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

Codes: `NOT_LOGGED_IN`, `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`,
`SERVER_ERROR`, `NETWORK`.

### Obtaining a token programmatically

The device-code flow used by `gitterm login` is exposed for integrations:

```ts
import { loginWithDeviceCode, saveConfig, DEFAULT_GITTERM_SERVER_URL } from "@gitterm/sdk";

const { token } = await loginWithDeviceCode(DEFAULT_GITTERM_SERVER_URL, {
  onCode: ({ verificationUri, userCode }) => {
    console.log(`Visit ${verificationUri} and enter ${userCode}`);
  },
});

await saveConfig({
  serverUrl: DEFAULT_GITTERM_SERVER_URL,
  token,
  createdAt: Date.now(),
});
```

Device-code logins produce the same revocable `gt_...` API token as the dashboard;
they appear in **Settings → Account → API tokens** and can be revoked there.

## License

MIT

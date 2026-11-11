---
title: SDK reference
nav: SDK
description: The @gitterm/sdk TypeScript client for workspaces, agent runs, connections, sandboxes, and errors, with real method names and options.
---

`@gitterm/sdk` is the TypeScript client for the Gitterm API. Use it to create cloud workspaces, run an agent in them, pass the agent's questions to a person, and run commands in sandboxes. The CLI, the OpenCode plugins and the chat bots are built on it. Use this page to look up a method or option.

## Install

```sh
npm install @gitterm/sdk
# or
bun add @gitterm/sdk
```

Requires Node 22.12 or later, or Bun.

## Client setup

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient({ token: process.env.GITTERM_API_TOKEN });
```

| Option       | Type           | Required | Default                                                                  | What it does                |
| ------------ | -------------- | -------- | ------------------------------------------------------------------------ | --------------------------- |
| `token`      | `string`       | No       | `GITTERM_API_TOKEN`, then the CLI login                                  | A `gt_...` API token        |
| `serverUrl`  | `string`       | No       | `GITTERM_SERVER_URL`, then the CLI login, then `https://api.gitterm.dev` | API base URL                |
| `configPath` | `string`       | No       | `~/.config/gitterm/cli.json`                                             | Where to read the CLI login |
| `fetch`      | `typeof fetch` | No       | Global `fetch`                                                           | Custom fetch                |

With no token from any source, calls fail with `NOT_LOGGED_IN`. For a self-hosted deployment behind the bundled path-routing proxy, use the `/api` path, for example `https://gitterm.example.com/api`. `client.serverUrl` and `client.auth.status()` show which server and account you are using.

### Tokens and scopes

Create tokens under **API tokens** in the dashboard, or sign in with `gitterm login`. A dashboard token can be limited to these scopes:

| Scope                | Allows                                                 |
| -------------------- | ------------------------------------------------------ |
| `identity:read`      | Read your account identity                             |
| `workspace:read`     | List and inspect workspaces                            |
| `workspace:access`   | Get runtime URLs, headers and server credentials       |
| `workspace:write`    | Create, start, pause, restart and terminate workspaces |
| `run:read`           | Inspect agent runs and messages                        |
| `run:write`          | Create and cancel agent runs                           |
| `integrations:read`  | List enabled integrations and your connections         |
| `integrations:write` | Connect and disconnect personal integrations           |

To get a token from your own app, use the device-code flow:

```ts
import { DEFAULT_GITTERM_SERVER_URL, loginWithDeviceCode, saveConfig } from "@gitterm/sdk";

const serverUrl = process.env.GITTERM_SERVER_URL ?? DEFAULT_GITTERM_SERVER_URL;
const { token } = await loginWithDeviceCode(serverUrl, {
  onCode: ({ verificationUri, userCode }) =>
    console.log(`Visit ${verificationUri}, enter ${userCode}`),
});
await saveConfig({ serverUrl, token, createdAt: Date.now() });
```

## Workspaces

A `workspace` argument is a workspace id, or any object with an `id`.

| Method                                          | Returns                                        | What it does                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces.create(input)`                      | `{ workspace, runtime }`                       | Create a workspace. See [Create options](#create-options)                                                                                                                                                                                      |
| `workspaces.list(options?)`                     | `{ workspaces, pagination }`                   | Filter by `status` (`active`, `all`, `terminated`), `metadata`, `limit`, `offset`                                                                                                                                                              |
| `workspaces.get(workspace)`                     | `Workspace`                                    | Read one workspace                                                                                                                                                                                                                             |
| `workspaces.getRuntimeAccess(workspace)`        | `WorkspaceRuntimeAccess`                       | URL, headers and password. Never resumes compute                                                                                                                                                                                               |
| `workspaces.ensureRunning(workspace, options?)` | `{ workspace, runtime }`                       | Resume if paused, and wait until running                                                                                                                                                                                                       |
| `workspaces.pause(workspace)`                   | `{ durationMinutes }`                          | Pause. Returns the length of the usage session it ended                                                                                                                                                                                        |
| `workspaces.restart(workspace)`                 | `{ status }`                                   | Resume a paused workspace                                                                                                                                                                                                                      |
| `workspaces.terminate(workspace, options?)`     | `{ workspace, cleanupInBackground, snapshot }` | Terminate for good. With `{ saveSnapshot: true }`, first keep it as its repository's [project snapshot](/docs/workspaces/move-a-session#start-from-a-project-snapshot), replacing the older one. If saving fails, the workspace is not deleted |
| `workspaces.projectSnapshot(workspace)`         | `{ available, reason?, existing }`             | Whether the workspace can be kept as a project snapshot, and the one it would replace                                                                                                                                                          |
| `workspaces.setupStatus(workspace)`             | `WorkspaceSetupStatus`                         | State of the `afterAgent` setup phase                                                                                                                                                                                                          |
| `workspaces.waitForSetup(workspace, options?)`  | `WorkspaceSetupStatus`                         | Wait for the `afterAgent` phase to finish                                                                                                                                                                                                      |
| `workspaces.models(workspace)`                  | `WorkspaceModelAccess`                         | Which credential sources were configured. No secrets                                                                                                                                                                                           |

Requests through a workspace's URL count as activity and hold off [idle pausing](/docs/workspaces/lifecycle#idle-pausing). If your own code only checks on a workspace, add the header `PASSIVE_REQUEST_HEADER` (exported by the SDK, value `"1"`) to those requests: they are routed as usual but not counted. `runs.get` and the other run reads already do this.

Waits accept `{ timeoutMs, pollIntervalMs, signal }`. On the server, `ensureRunning` waits at most 240000 ms.

For statuses, idle pausing and what survives a pause, see [Lifecycle](/docs/workspaces/lifecycle).

### Create options

| Option                        | Type                                        | Required | Default                | What it does                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo`                        | `string`                                    | Yes      |                        | Repository URL                                                                                                                                                                                                                                                                                                            |
| `branch`                      | `string`                                    | No       | The repository default | Branch to check out                                                                                                                                                                                                                                                                                                       |
| `baseCommit`                  | `string`                                    | No       | The branch head        | Commit SHA to pin the checkout to                                                                                                                                                                                                                                                                                         |
| `checkoutRef`                 | `string`                                    | No       | `branch`               | Branch or tag to clone, when different from `branch`. Not a commit SHA                                                                                                                                                                                                                                                    |
| `name`                        | `string`                                    | No       |                        | Display name                                                                                                                                                                                                                                                                                                              |
| `agent`                       | `"opencode" \| "opencode-ttyd" \| "t3code"` | No       | `opencode`             | See [Agents](/docs/workspaces/agents)                                                                                                                                                                                                                                                                                     |
| `provider`                    | `{ type, region?, machine?, providerId? }`  | No       | Your default provider  | Such as `{ type: "e2b" }`. `machine` is `{ type: "profile", key }`. `region` exists for Railway and AWS                                                                                                                                                                                                                   |
| `connections`                 | `string[]`                                  | No       | None                   | Connection ids, names or integration keys. See [Connections](/docs/integrations/connections#reference-a-connection)                                                                                                                                                                                                       |
| `repositoryCredentials`       | `{ username?, token }`                      | No       | None                   | Inline Git token. Not renewed. Can't be combined with a GitHub connection                                                                                                                                                                                                                                                 |
| `models`                      | `WorkspaceModelsInput`                      | No       | Every saved credential | Model credentials and default model. See [Agents](/docs/workspaces/agents#choose-credentials-from-the-sdk)                                                                                                                                                                                                                |
| `persistent`                  | `boolean`                                   | No       | The provider's default | Persistent storage, where the provider makes it optional                                                                                                                                                                                                                                                                  |
| `alwaysOn`                    | `boolean`                                   | No       | `false`                | Don't pause when idle. Needs a paid plan on managed Gitterm                                                                                                                                                                                                                                                               |
| `autoTerminateAfterMs`        | `number`                                    | No       | None                   | Terminate this long after creation: 1 minute to 30 days                                                                                                                                                                                                                                                                   |
| `metadata`                    | `Record<string, string>`                    | No       | None                   | Your own tags. Up to 20 keys. Filter with `list({ metadata })`                                                                                                                                                                                                                                                            |
| `image`                       | `string`                                    | No       | The catalog image      | Your own image: a public OCI image on Railway, AWS, Daytona and exe.dev, or a public template on E2B. Not supported on other providers                                                                                                                                                                                    |
| `setup`                       | `{ beforeAgent?, afterAgent? }`             | No       | None                   | Shell commands. `beforeAgent` blocks startup and fails `create()` if it fails. `afterAgent` runs once the agent answers                                                                                                                                                                                                   |
| `secretFiles`                 | `{ path, content, mode? }[]`                | No       | None                   | Files written in the repository and excluded from Git. `mode` is `"0400"` or `"0600"`                                                                                                                                                                                                                                     |
| `environmentVariables`        | `Record<string, string>`                    | No       | None                   | Variables for this workspace only                                                                                                                                                                                                                                                                                         |
| `opencode`                    | `{ config?, plugins?, skills? }`            | No       | None                   | OpenCode config, plugins and skills for this workspace                                                                                                                                                                                                                                                                    |
| `additionalAgentInstructions` | `string`                                    | No       | None                   | Appended to the workspace's global `AGENTS.md`                                                                                                                                                                                                                                                                            |
| `subdomain`                   | `string`                                    | No       | Generated              | Custom subdomain. Needs a paid plan on managed Gitterm                                                                                                                                                                                                                                                                    |
| `useProjectSnapshot`          | `boolean`                                   | No       | `false`                | Start from your [project snapshot](/docs/workspaces/move-a-session#start-from-a-project-snapshot) for `repo`, when it was saved on the same provider, image and machine size. Otherwise the workspace starts fresh. If the snapshot can't start, `create()` fails with `PROJECT_SNAPSHOT_FAILED`: create again without it |
| `idempotencyKey`              | `string`                                    | No       | None                   | Return the same workspace when a create is retried                                                                                                                                                                                                                                                                        |

Setup commands can use `$WORKSPACE_REPO_DIR` for the checkout path on any provider. To change secrets or variables later, create a new workspace.

## Runs

A run sends a prompt to an OpenCode workspace and tracks it to the end. T3 Code workspaces don't support runs. A `run` argument is an `AgentRun`, or any `{ workspaceId, id }`.

```ts
const run = await client.runs.create({
  workspace,
  idempotencyKey: "review-pr-42",
  prompt: "Review PR #42 and fix the failing tests.",
});
const result = await client.runs.result(run);
console.log(result.finalText);
```

| Method                                    | Returns                        | What it does                                                                                                       |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `runs.create(input)`                      | `AgentRun`                     | Submit a prompt. Waits for a `pending` workspace and for the agent to answer                                       |
| `runs.list(workspace, options?)`          | `{ runs, pagination }`         | `status`: `all`, `active`, `terminal`. `limit` 1 to 50, default 20                                                 |
| `runs.get(run)`                           | `AgentRun`                     | Current state                                                                                                      |
| `runs.messages(run)`                      | `AgentRunMessage[]`            | Transcript with text and tool calls. Tool output is cut at 4000 characters                                         |
| `runs.cancel(run)`                        | `{ cancelled }`                | Stop the run                                                                                                       |
| `runs.watch(run, { signal }?)`            | `AsyncIterable<AgentRun>`      | Every state until terminal, pushed over server-sent events                                                         |
| `runs.wait(run, options?)`                | `AgentRun`                     | First terminal or `awaiting_input` state. `until: "terminal"` waits for the end. `timeoutMs` default 30 minutes    |
| `runs.events(run, { signal }?)`           | `AsyncIterable<AgentRunEvent>` | Events to act on, for a relay to a person                                                                          |
| `runs.respond(run, { requestId, reply })` | `AgentRun`                     | Answer a permission request or question                                                                            |
| `runs.result(run, options?)`              | `AgentRunResult`               | Resolves on success. Optional `onPermission` and `onQuestion` handlers, `timeoutMs` (default 30 minutes), `signal` |

### Create input

| Option           | Type                                                | Required | Default               | What it does                                                               |
| ---------------- | --------------------------------------------------- | -------- | --------------------- | -------------------------------------------------------------------------- |
| `workspace`      | `string \| { id }`                                  | Yes      |                       | The workspace                                                              |
| `prompt`         | `string`                                            | Yes      |                       | The prompt                                                                 |
| `idempotencyKey` | `string`                                            | No       | A random UUID         | Same key and input return the same run. Pass your own to make retries safe |
| `model`          | `string`                                            | No       | The workspace default | `provider/model` for this run                                              |
| `agent`          | `string`                                            | No       | OpenCode's default    | OpenCode agent name                                                        |
| `title`          | `string`                                            | No       |                       | Run title                                                                  |
| `attachments`    | `{ name?, mime, data }[]`                           | No       | None                  | Base64 files. At most 10, and 20 MB in total                               |
| `context`        | `{ type: "isolated" } \| { type: "continue", run }` | No       | `isolated`            | `continue` carries on from a finished run's conversation                   |
| `waitForSetup`   | `boolean`                                           | No       | `false`               | Wait for `afterAgent` setup to succeed first                               |
| `setupTimeoutMs` | `number`                                            | No       |                       | How long to wait for setup. Server maximum 600000                          |
| `startTimeoutMs` | `number`                                            | No       | 120000                | How long to wait for a `pending` workspace. Maximum 240000                 |
| `deadlineAt`     | `string`                                            | No       | None                  | Absolute deadline the server enforces, even if your client disconnects     |
| `signal`         | `AbortSignal`                                       | No       |                       | Abort the waits                                                            |

`runs.create()` does not resume a paused workspace. Call `workspaces.ensureRunning()` first.

### Statuses and events

Run statuses: `pending`, `running`, `retrying`, `awaiting_input`, `completed`, `failed`, `cancelled`.

Event types from `runs.events()`: `run.status`, `input.required`, `input.resolved`, `run.completed`, `run.failed`, `run.cancelled`.

```ts
for await (const event of client.runs.events(run)) {
  if (event.type === "input.required") {
    await client.runs.respond(run, {
      requestId: event.request.id,
      reply: await askHuman(event.request),
    });
  }
}
```

`askHuman` is your own function: show the request to a person and return their reply. Replies look like:

```ts
{ type: "permission", response: "once" } // or "always" or "reject"
{ type: "question", answers: { [question.key]: ["Selected label"] } }
{ type: "question", reject: true }
```

A run waiting for input keeps the workspace awake until you answer, cancel the run, or its `deadlineAt` passes. To avoid prompts in unattended runs, allow tools in `opencode.config.permission` when you create the workspace.

## Integrations

| Method                                                     | What it does                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `integrations.catalog()`                                   | Integrations the admin turned on, and whether each allows personal or shared connections              |
| `integrations.connections.list(filter?)`                   | Connections you can attach. Filter by `integration` or `kind`                                         |
| `integrations.connections.get(id)`                         | One connection                                                                                        |
| `integrations.connections.resolve(references, { repo }?)`  | What a `connections` list would attach, without creating anything                                     |
| `integrations.connections.create(input)`                   | Create a personal connection. Needs `integrations:write`. May return `pending` with an `authorizeUrl` |
| `integrations.connections.waitFor({ integration, since })` | Wait for a connection after a browser step                                                            |
| `integrations.connections.remove(id)`                      | Remove a personal connection                                                                          |
| `integrations.github.repositories(connectionId)`           | Repositories a GitHub App connection can reach                                                        |
| `integrations.github.branches(connectionId, owner, repo)`  | Branches of a repository                                                                              |
| `integrations.google.setup()`                              | Issuer and attribute mapping to configure in Google Cloud                                             |
| `integrations.mcp.test(id)`                                | Test an MCP connection                                                                                |
| `integrations.mcp.update(input)`                           | Update an MCP connection. Leave out `authentication` to keep the saved credential                     |

How each integration works: [Connections](/docs/integrations/connections).

## Catalog and credentials

| Method                                | What it does                                                 |
| ------------------------------------- | ------------------------------------------------------------ |
| `catalog.agentTypes({ serverOnly }?)` | Agents you can run                                           |
| `catalog.cloudProviders(filter?)`     | Enabled providers                                            |
| `catalog.workspaceOptions()`          | Providers, regions and machine sizes you may use             |
| `credentials.list()`                  | Saved model credentials: labels and providers, never secrets |
| `credentials.listProviders()`         | Model providers and their `logicalProviderKey`               |
| `bots.self()`                         | The saved bot settings for this token, or `null`             |

## Workspace client

Inside a workspace, `createGittermWorkspaceClient()` uses the identity Gitterm injects (`WORKSPACE_API_URL`, `WORKSPACE_AUTH_TOKEN`, `WORKSPACE_ID`). It can only see that workspace.

| Method                                     | What it does                      |
| ------------------------------------------ | --------------------------------- |
| `self.get()`                               | This workspace and its ports      |
| `ports.list()`                             | Open ports                        |
| `ports.open(port, { name?, visibility? })` | Open a port, `private` by default |
| `ports.setVisibility(port, visibility)`    | `private` or `public`             |
| `ports.close(port)`                        | Close a port                      |

See [Previews](/docs/workspaces/previews).

## Sandboxes

`@gitterm/sdk/sandbox` runs commands in a plain remote sandbox, with no agent inside, for a local agent or script. An account with `apiKey` or `apiKeyEnv` uses your own provider key; one without goes through your Gitterm plan (`{ size: "medium" }`, or `serverUrl` and `provider` for a self-hosted server). For the model, limits and accounts, see [Sandboxes](/docs/sandboxes/overview).

```ts
import {
  captureSource,
  createSandboxBackend,
  createSandboxClient,
  resolveSandboxAccount,
} from "@gitterm/sdk/sandbox";

const account = await resolveSandboxAccount({ provider: "e2b", apiKeyEnv: "E2B_API_KEY" });
const sandboxes = createSandboxClient({ backend: createSandboxBackend(account) });

const sandbox = await sandboxes.create({ name: "ci", lifetimeMinutes: 30 });
await sandboxes.sync(sandbox, await captureSource(process.cwd()));
const job = await sandboxes.exec(sandbox, { command: "npm test", waitMs: 300_000 });
console.log(job.state.status, job.log.text);
await sandboxes.destroy(sandbox);
```

Methods: `create`, `list`, `get`, `sync`, `exec`, `job`, `wait`, `cancel`, `preview`, `fetchArtifact`, `applyArtifact`, `resume`, `destroy`.

`preview()` returns `url`, the URL to open, with `public`, `ready`, and `viaGitterm` (true when Gitterm serves `url`; a private one opens for the owner signed in to Gitterm). `access` holds the direct provider `url` and `headers` for a local proxy such as `startPreviewProxy`. The headers are secret: keep them away from models, logs, and storage.

The Gitterm sandbox calls are also on the main client: `client.sandboxes.providers`, `create`, `list`, `get`, `run`, `writeFile`, `readFile`, `preview`, `resume` and `terminate`.

## Direct provider mode

`@gitterm/sdk/direct` runs the same workspace and run API against your own provider account, with no Gitterm server. Your app owns state, cleanup and credentials. It supports E2B, Daytona, Vercel, Boat, exe.dev and Railway.

```ts
import { createDirectGittermClient } from "@gitterm/sdk/direct";

const direct = createDirectGittermClient({
  provider: { type: "e2b", apiKey: process.env.E2B_API_KEY!, size: "standard" },
});
```

Direct mode accepts `repositoryCredentials` but not `connections`, and only inline model credentials (`{ source: "apiKey" }`).

## Errors

Every API error is a `GittermError` with a stable `code`. Match on the code, not the message.

```ts
import { GittermError, WorkspaceLifecycleError } from "@gitterm/sdk";

try {
  await client.runs.create({ workspace: workspaceId, prompt });
} catch (error) {
  if (error instanceof WorkspaceLifecycleError && error.code === "WORKSPACE_NOT_RUNNING") {
    await client.workspaces.ensureRunning(workspaceId);
  } else if (error instanceof GittermError && error.code === "TIMEOUT") {
    // the wait ended; the run may still be going
  } else throw error;
}
```

| Class                        | Codes                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GittermError`               | `NOT_LOGGED_IN`, `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, `CONFLICT`, `SERVER_ERROR`, `NETWORK`, `TIMEOUT`, `ABORTED`, `INPUT_NOT_PENDING` |
| `GittermError` (credentials) | `MODEL_CREDENTIAL_INVALID`, `MODEL_CREDENTIAL_UNAVAILABLE`, `MODEL_CREDENTIAL_REQUIRED`, `MODEL_CREDENTIAL_DUPLICATE_PROVIDER`                             |
| `WorkspaceLifecycleError`    | `WORKSPACE_NOT_RUNNING`, `WORKSPACE_TERMINATED`, `WORKSPACE_START_TIMEOUT`, `WORKSPACE_NON_RECOVERABLE`, `WORKSPACE_RESTART_FAILED`                        |
| `AgentRunError`              | `INPUT_REQUIRED`, `RUN_FAILED`, `RUN_CANCELLED`. The run is on `error.run`                                                                                 |

`GittermError.status` holds the HTTP status when the server answered. `TIMEOUT` and `ABORTED` stop the wait, not the agent; call `runs.cancel()` to stop the agent.

## Related

- [CLI reference](/docs/reference/cli)
- [Cloud workspaces](/docs/workspaces/overview)
- [Connections](/docs/integrations/connections)

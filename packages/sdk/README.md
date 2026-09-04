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
dashboard integration. Omitting `modelCredentials` likewise continues to
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
client.workspaces.list(options?);     // -> { workspaces, pagination }; filter by status or metadata
client.workspaces.get(workspace);      // workspace = id string or any object with an `id`
client.workspaces.getRuntimeAccess(workspace); // read-only; never resumes compute
client.workspaces.ensureRunning(workspace, options?); // resume if paused, wait until running
client.workspaces.setupStatus(workspace);
client.workspaces.waitForSetup(workspace, options?);
client.workspaces.pause(workspace);    // -> { durationMinutes } of the usage session just closed
client.workspaces.restart(workspace);
client.workspaces.terminate(workspace); // -> { workspace, cleanupInBackground }
client.workspaces.create({
  repo: "https://github.com/acme/product",
});
client.runs.create(input);
client.runs.list(workspace, options?); // -> { runs, pagination }
client.runs.get(run);                  // run = AgentRun, { workspaceId, runId }, or (workspaceId, runId)
client.runs.messages(run);
client.runs.cancel(run);
client.runs.wait(run, options?);        // resolves when terminal or awaiting_input (push-based)
client.runs.respond(run, { requestId, reply }); // answer a permission prompt or agent question
client.catalog.agentTypes();
client.catalog.cloudProviders();
client.catalog.workspaceOptions();
```

Every wait (`ensureRunning`, `waitForSetup`, and `runs.create` with `waitForSetup`) accepts
`{ timeoutMs, pollIntervalMs, signal }`. `runs.wait` is push-based (server-sent events) and
accepts `{ timeoutMs, signal, until }`. Pass an `AbortSignal` to stop waiting on shutdown; the
promise rejects with code `ABORTED`.

`pause()` returns `durationMinutes`, the length of the usage session it just closed, which is
what billing records. `terminate()` returns `cleanupInBackground: true` when the provider
finishes tearing down resources after the call returns.

#### Tagging and lifetime

`metadata` attaches caller-owned tags to a workspace so you can find it again without a
lookup table of your own, and `autoTerminateAfterMs` caps how long it can live:

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  metadata: { tenant: "acme", channel: "C0123" },
  autoTerminateAfterMs: 2 * 60 * 60 * 1000, // gone in 2h even if this process crashes
});

const { workspaces } = await client.workspaces.list({
  metadata: { tenant: "acme", channel: "C0123" },
});
```

Metadata allows up to 20 keys of letters, digits, `_ . : -`, with values up to 500 characters,
and `list` matches workspaces containing every given pair. `autoTerminateAfterMs` ranges from
1 minute to 30 days; the reaper terminates the workspace once the time passes regardless of
activity, and `workspace.autoTerminateAt` shows the deadline. Idle workspaces are still paused
by the platform's idle policy independently of this.

#### Bring your own image

Pass `image` to run your own build instead of the catalog image. On the managed service the
image must be pullable without credentials; creation fails immediately with the reason if it
isn't, rather than leaving a workspace stuck pulling.

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  provider: { type: "railway" },
  image: "ghcr.io/acme/agent-runner:1.4.0",
});

// E2B takes a public template id or alias instead of a registry reference.
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  provider: { type: "e2b" },
  image: "acme-python-runner",
});
```

Supported on Railway, AWS, Daytona, exe.dev, and E2B. Vercel and Cloudflare run fixed
runtimes and reject `image`. Floating tags such as `latest` are pinned to the digest verified
at create time, so a restart months later runs the same image; `workspace.customImage` shows
what was pinned.

The image has to behave like the stock one, because GitTerm's entrypoint does the clone, writes
agent files, runs setup phases, and starts the agent. Layer on the published base and keep its
entrypoint:

```dockerfile
FROM opeoginni/gitterm-opencode-server:latest
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip poppler-utils \
  && rm -rf /var/lib/apt/lists/*
```

Rules: do not override `ENTRYPOINT` or `CMD`; keep global installs outside `/workspace`, which
is a persisted volume; keep `opencode` and `@gitterm/cli` on `PATH`; keep port 7681. For E2B,
build your template from the same base and publish it so any account can start it.

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

### Workspace lifecycle and readiness

A workspace has one of four statuses:

| Status       | Meaning                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `pending`    | Compute is being provisioned or resumed. `runtime.url` is `null`.                         |
| `running`    | The provider reports the sandbox or container up. The agent process may still be booting. |
| `paused`     | Stopped but resumable.                                                                    |
| `terminated` | Gone for good.                                                                            |

Whether `create()` returns `running` or `pending` depends on the provider. Sandbox providers
(E2B, Daytona, Vercel, Ascii, exe.dev, Cloudflare) settle immediately and return `running`.
Railway settles by webhook and returns `pending` until its deployment reports success, usually
within a minute. Code that only ever ran against a sandbox provider will see `pending` for the
first time when it moves to Railway.

Three things have to be true before a prompt can be delivered, and the SDK handles each:

1. **The workspace is `running`.** `runs.create()` waits for a `pending` workspace to
   transition on its own, up to `startTimeoutMs` (default 120s). It does not resume a `paused`
   workspace; call `ensureRunning()` for that, which resumes, polls until `running`, and returns
   the runtime access.
2. **The agent answers.** `running` is the provider's view. `runs.create()` then probes the
   workspace URL until the agent server responds before submitting the prompt, so callers never
   need their own health check.
3. **Setup finished (optional).** `afterAgent` commands run in the background once the agent is
   reachable. Pass `waitForSetup: true` to `runs.create()` to block on them, or poll with
   `setupStatus()` / `waitForSetup()`. Status `waiting` means the agent isn't reachable yet, so
   setup hasn't started; `running`, `succeeded`, and `failed` describe the phase itself;
   `not_requested` means there were no `afterAgent` commands. The SDK polls setup from the
   client so a long `npm ci` never holds one HTTP request open; that polling needs the
   `workspace:read` scope on the token in addition to `run:write`. `waiting` cannot last
   forever: while you poll, the server also reads the setup state files inside the workspace
   (through the agent when the provider has no exec channel), and if nothing has progressed
   after 15 minutes it marks the setup `failed` with a log explaining what stalled.

The shortest correct sequence is therefore:

```ts
const { workspace } = await client.workspaces.create({ repo, setup: { afterAgent: ["npm ci"] } });
const run = await client.runs.create({
  workspaceId: workspace.id,
  idempotencyKey: `review-${sha}`,
  waitForSetup: true,
  prompt: "Review the open pull request",
});
const done = await client.runs.wait(workspace.id, run.id);
```

For a workspace you didn't just create, start with `ensureRunning()`:

```ts
const { workspace, runtime } = await client.workspaces.ensureRunning(workspaceId);
// runtime.url is set; workspace.status is "running"
```

Failures surface as `WorkspaceLifecycleError` with stable codes: `WORKSPACE_NOT_RUNNING` (the
workspace is `paused`, or stopped while waiting), `WORKSPACE_TERMINATED`,
`WORKSPACE_START_TIMEOUT` (still `pending` after the timeout, or no runtime URL),
`WORKSPACE_NON_RECOVERABLE`, and `WORKSPACE_RESTART_FAILED`.

Direct provider mode behaves differently: `direct.workspaces.create()` waits for the OpenCode
runtime to answer before returning, so a direct workspace is ready for `runs.create()` as soon
as `create()` resolves.

### Agent runs

Runs use durable GitTerm IDs backed by the workspace's native OpenCode session. Reusing an
idempotency key with the same input returns the original run, and terminal results remain
available after the workspace is paused. `idempotencyKey` defaults to a random UUID; pass your
own whenever a retry could otherwise submit the same prompt twice. Completion means the native
session became idle; it does not claim that a pull request, upload, or other product outcome
succeeded.

Every run carries `createdAt`, `submittedAt` (when the prompt reached the agent), and
`completedAt`. `runs.list(workspace, { status: "active" })` returns what is still in flight, so a
process recovering after a restart can pick up where it left off without having persisted run
ids itself. The server watches every active run's OpenCode session and keeps the run current;
`get`/`list`/`messages` read that state without touching the workspace.

Statuses: `pending` → `running` (or `retrying` while OpenCode backs off from the model
provider) → `completed` | `failed` | `cancelled`. A run that stops to ask something is
`awaiting_input` until you answer it (below).

`runs.messages()` returns each turn's concatenated `text` plus an ordered `parts` array. Tool
calls appear as `{ type: "tool", tool, status, title, input, output, error }` with output
truncated to 4000 characters, which is usually enough to see why a run went wrong:

```ts
for (const message of await client.runs.messages(run)) {
  for (const part of message.parts) {
    if (part.type === "tool" && part.status === "error") {
      console.log(part.tool, part.title, part.error);
    }
  }
}
```

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

#### Questions and permission prompts

When the agent calls OpenCode's `question` tool, or a tool needs approval under your
`permission` config, the run becomes `awaiting_input` and `run.pendingInputs` describes what it
is waiting for. `runs.wait()` returns at that point by default; answer with `runs.respond()` and
wait again. This is what makes a chat bot able to relay "should I do A or B?" to a human.

```ts
let run = await client.runs.wait(workspace.id, created.id);
while (run.status === "awaiting_input") {
  for (const request of run.pendingInputs) {
    if (request.kind === "permission") {
      // request.title, e.g. "bash: rm -rf dist"; also permission / patterns / always
      await client.runs.respond(run, {
        requestId: request.id,
        reply: { type: "permission", response: "once" }, // "once" | "always" | "reject"
      });
    } else {
      // request.questions[i] has header, question, options[{ label, description }], multiple, custom
      const answers = request.questions.map((question) => [question.options[0]!.label]);
      await client.runs.respond(run, {
        requestId: request.id,
        reply: { type: "question", answers },
      });
      // or: reply: { type: "question", reject: true }
    }
  }
  run = await client.runs.wait(workspace.id, created.id);
}
```

Rejecting a permission or dismissing a question ends the turn: OpenCode records a failed tool
call and the run finishes. Pass `{ until: "terminal" }` to `runs.wait()` to keep waiting through
`awaiting_input` (for example when a separate process answers). A run left `awaiting_input` does
not keep its workspace awake; if nobody answers before the workspace's idle timeout pauses it,
the run is cancelled with `"Workspace paused while waiting for input"`. To avoid prompts entirely
in headless runs, allow the relevant tools in `opencode.config.permission` when creating the
workspace.

`runs.wait()` uses a lightweight lifecycle stream internally; it does not mirror OpenCode's
native message, tool, or token events. `runs.messages()` provides the persisted transcript at
lifecycle checkpoints and completion. For live execution details, use
`workspaces.getRuntimeAccess()` with the official OpenCode SDK.

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

`modelCredentials` takes one entry per provider. Each entry selects where that provider's
credential comes from, and the three forms compose in one array:

```ts
const { workspace } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  modelCredentials: [
    { providerName: "openai", label: "work" }, // dashboard credential, by label
    { providerName: "anthropic" }, // that provider's dashboard default
    { providerName: "google", apiKey: process.env.GOOGLE_API_KEY! }, // inline, this workspace only
  ],
});
```

**Dashboard credentials** are addressed by `providerName` plus the `label` you gave them in the
dashboard (labels are unique per provider). Omit `label` to use the provider's default. The SDK
never returns credential secrets; `client.credentials.list()` returns metadata including labels
if you need to discover them, and requires an API token with the `workspace:write` scope.

**Inline credentials** pass an API key directly for this workspace only. They are injected into
the provisioned agent and never stored in the dashboard. Use `client.credentials.listProviders()`
for valid provider names; OAuth providers (e.g. GitHub Copilot) can only be connected through
the dashboard.

const run = await client.runs.create({
workspaceId: workspace.workspaceId,
model: "anthropic/claude-sonnet-4-20250514",
prompt: "Record before/after videos of the changes in PR #42",
});

````

Rules and errors:

- Omit `modelCredentials` to inject every dashboard default.
- Naming any dashboard credential (an entry without `apiKey`) switches off the implicit defaults,
  so list each provider the workspace needs. Inline-only arrays keep the defaults for the other
  providers.
- One credential per logical provider. An inline credential always overrides the dashboard
  credential for the same provider; two entries for the same provider throw
  `MODEL_CREDENTIAL_DUPLICATE_PROVIDER`.
- Unknown providers or inline keys for OAuth-only providers throw `MODEL_CREDENTIAL_INVALID`.
  A label that doesn't exist throws `MODEL_CREDENTIAL_UNAVAILABLE` and the message lists the
  labels that do.
- A run that requests a credential-backed `provider/model` not available in its workspace throws
  `MODEL_CREDENTIAL_REQUIRED` before the prompt is submitted.

Use `client.runs.cancel(workspaceId, runId)` to abort the current run; a run that is
`awaiting_input` has its pending prompt rejected first. GitTerm keeps the underlying OpenCode
session private. For native session control, use `workspaces.getRuntimeAccess()` and connect
with the official OpenCode SDK.

### OpenCode API versions

Managed workspaces continue to run `opencode-ai@latest` (`opencodeApi: "v1"`). OpenCode 2
changes the server API; callers testing it must supply their own compatible image and create the
workspace with `opencode: { api: "v2" }`. Runs, questions, permissions, and events behave the
same from the SDK's point of view; the flag only tells GitTerm which protocol to speak to the
workspace. `v2` is experimental until OpenCode 2 ships.

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
````

Workspace lifecycle failures are also exposed as `WorkspaceLifecycleError`, with stable
`WORKSPACE_NOT_RUNNING`, `WORKSPACE_TERMINATED`, `WORKSPACE_NON_RECOVERABLE`,
`WORKSPACE_START_TIMEOUT`, and `WORKSPACE_RESTART_FAILED` codes. General codes are
`NOT_LOGGED_IN`, `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, `CONFLICT`,
`SERVER_ERROR`, `NETWORK`, and `ABORTED` (a wait was cancelled through its `signal`).

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

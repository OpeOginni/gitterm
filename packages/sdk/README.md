# @gitterm/sdk

TypeScript SDK for the [GitTerm](https://gitterm.dev) API: create sandboxed workspaces for a
repository, run an agent in them, and relay the questions it asks back to a human. Used by the
`gitterm` CLI, the OpenCode plugin, and integrations such as Slack bots.

## Install

```sh
bun add @gitterm/sdk
# or
npm install @gitterm/sdk
```

Requires Node 22.12+ or Bun. Create an API token in the dashboard under
**Settings → Account → API tokens**, or with `gitterm login`.

## Quick start

Create a workspace, run a prompt, and get the final result:

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient({ token: process.env.GITTERM_API_TOKEN });

const { workspace } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  repositoryCredentials: { token: process.env.GITHUB_TOKEN! },
  autoTerminateAfterMs: 2 * 60 * 60 * 1000,
});

try {
  const run = await client.runs.create({
    workspace,
    idempotencyKey: "review-pr-42",
    prompt: "Review PR #42 and fix the failing tests.",
  });
  const result = await client.runs.result(run);
  console.log(result.finalText);
} finally {
  await client.workspaces.terminate(workspace);
}
```

`result()` returns only on successful completion. If the agent asks something and no handler is
registered, it throws `AgentRunError` with code `INPUT_REQUIRED` and the current `error.run`.
Register `onPermission` / `onQuestion` handlers for interactive runs, or use the event relay below.
The quick start's `finally` deliberately terminates the workspace on any error; omit that cleanup
if your application needs to keep a blocked run available for a later answer.

`askHuman` is your side of an event relay: show the request, wait for an answer, and return an
`AgentRunReply`. This terminal example gives up after ten minutes:

```ts
import { createInterface } from "node:readline/promises";
import type { AgentRunInputRequest, AgentRunReply } from "@gitterm/sdk";

async function prompt(text: string, signal: AbortSignal): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(text, { signal })).trim();
  } catch {
    return null; // the deadline passed
  } finally {
    rl.close();
  }
}

async function askHuman(request: AgentRunInputRequest): Promise<AgentRunReply> {
  const deadline = AbortSignal.timeout(10 * 60_000);
  if (request.kind === "permission") {
    // request.title, e.g. "bash: rm -rf dist"
    const answer = await prompt(`Allow ${request.title}? [yes/always/no] `, deadline);
    if (answer === null) return { type: "permission", response: "reject" };
    return {
      type: "permission",
      response: answer === "always" ? "always" : answer === "yes" ? "once" : "reject",
    };
  }
  const answers: Record<string, string[]> = {};
  for (const question of request.questions) {
    const labels = question.options.map((option) => option.label).join(" | ");
    const answer = await prompt(`${question.header}: ${question.question} [${labels}] `, deadline);
    if (answer === null) return { type: "question", reject: true }; // nobody answered in time
    answers[question.key] = question.multiple ? answer.split(",").map((s) => s.trim()) : [answer];
  }
  return { type: "question", answers };
}
```

Rejecting a permission or a question ends the agent's turn; the run then finishes as
`completed` or `failed` with what it managed to do. The rest of this document explains each
step in depth. Direct provider mode, which runs the same API against your own cloud account
without a GitTerm server, is described at the [end](#direct-provider-mode).

## Configuration

`createGittermClient()` resolves its server and token in this order: constructor options →
`GITTERM_SERVER_URL` / `GITTERM_API_TOKEN` → the CLI config at `~/.config/gitterm/cli.json`
written by `gitterm login`. The default server is the hosted API at `https://api.gitterm.dev`;
self-hosted instances use the same SDK with their own `serverUrl`:

```ts
const hosted = createGittermClient({ token: process.env.GITTERM_API_TOKEN });
const selfHosted = createGittermClient({
  serverUrl: "https://gitterm.example.com", // or http://localhost:3000
  token: process.env.GITTERM_API_TOKEN,
});
const fromCli = createGittermClient(); // env vars, then the CLI's saved login
```

Tokens are the same `gt_...` shape on hosted and self-hosted. `client.auth.status()` and
`client.serverUrl` show which account and server you hit.

## API

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
client.workspaces.create({ repo: "https://github.com/acme/product" });
client.runs.create(input);
client.runs.list(workspace, options?); // -> { runs, pagination }
client.runs.get(run);                  // run = AgentRun or any { workspaceId, id }
client.runs.messages(run);
client.runs.cancel(run);
client.runs.watch(run, options?);       // AsyncIterable<AgentRun>: every lifecycle state until terminal
client.runs.wait(run, options?);        // first state that is terminal or awaiting_input
client.runs.result(run, options?);      // successful final result; optional input handlers
client.runs.events(run, options?);      // actionable, subscriber-deduplicated input/lifecycle events
client.runs.respond(run, { requestId, reply }); // answer a permission prompt or agent question
client.catalog.agentTypes();
client.catalog.cloudProviders();
client.catalog.workspaceOptions();
client.credentials.list();             // dashboard credential metadata, never secrets
client.credentials.listProviders();
client.models.list({ provider: "openai" }); // discover provider/model IDs
client.workspaces.models(workspace);  // resolved sources + known models; no secrets or runtime wake-up
```

Every poll-based wait (`ensureRunning`, `waitForSetup`, and `runs.create` with `waitForSetup`)
accepts `{ timeoutMs, pollIntervalMs, signal }`. `runs.watch` is push-based (server-sent events)
and accepts `{ signal }`; `runs.wait` adds `{ timeoutMs, until }`. An `AbortSignal` stops any of
them with code `ABORTED`; an elapsed `timeoutMs` rejects with code `TIMEOUT`.

`pause()` returns `durationMinutes`, the length of the usage session it just closed, which is
what billing records. `terminate()` returns `cleanupInBackground: true` when the provider
finishes tearing down resources after the call returns.

## Workspaces

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
dashboard integration. Omitting `models` likewise continues to
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

### Tagging and lifetime

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

### Bring your own image

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
  workspace,
  idempotencyKey: `review-${sha}`,
  waitForSetup: true,
  prompt: "Review the open pull request",
});
const done = await client.runs.result(run);
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

## Agent runs

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

### Following a run

For the common interactive case, let the SDK drive the loop:

```ts
const result = await client.runs.result(run, {
  timeoutMs: 30 * 60_000,
  onPermission: async (request, { signal }) => {
    // Your UI returns "once", "always", or "reject". Never approve implicitly.
    return await askForApproval(request, signal);
  },
  onQuestion: async (request, { signal }) => {
    // Return { answers: { [question.key]: [selectedLabel] } } or { reject: true }.
    return await collectAnswers(request, signal);
  },
});
console.log(result.finalText);
```

The total deadline includes handler time. A timeout or abort stops observation, **not the agent**;
call `runs.cancel(run)` to stop it. Handlers receive a signal to close their own UI. Handlers are
not invoked twice for the same request during one `result()` call. Failed/cancelled runs throw
`AgentRunError` with `RUN_FAILED` / `RUN_CANCELLED`, retaining the run snapshot on `error.run`.

For a bot or queue-based relay, use actionable events instead of processing every state snapshot:

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

For a deferred reply, publish the request to your UI/queue instead, persist the run reference and
request ID, and call `respond()` from the later handler. Event types are `run.status`,
`input.required`, `input.resolved`, `run.completed`, `run.failed`, and `run.cancelled`.
Deduplication is per iterator, not durable exactly-once delivery: a new subscriber receives any
still-pending input again. Persist `(run.id, request.id)` as your UI/queue deduplication key.
`INPUT_NOT_PENDING` means a stale or already-resolved request; refresh the run rather than retrying
the answer blindly. The API does not claim that a repeated answer is idempotent.

`runs.watch(run)` is an async iterable of the run's lifecycle states. It starts with the current
state, yields a new `AgentRun` whenever the status or the pending inputs change, and ends after
the terminal state. It is push-based (server-sent events), so there is nothing to poll:

```ts
for await (const state of client.runs.watch(run, { signal })) {
  console.log(state.status);
}
```

`runs.wait(run, options?)` is a helper over `watch()` that resolves with the first state that
needs attention: a terminal state, or `awaiting_input` unless you pass `until: "terminal"`.
It takes `timeoutMs` (default 30 minutes; rejects with code `TIMEOUT`) and `signal` (rejects
with `ABORTED`). Use `wait()` when you want a separate timeout per phase, as a chat bot that
gives the agent twenty minutes per turn but a human thirty minutes per question would;
otherwise `watch()` with one `AbortSignal` is simpler.

### Questions and permission prompts

When the agent calls OpenCode's `question` tool, or a tool needs approval under your
`permission` config, the run becomes `awaiting_input` and `run.pendingInputs` lists what it is
waiting for. There is usually one request; there are several when the agent issued parallel tool
calls that each need approval. Answer each with `runs.respond()`; the run resumes once none
remain. The exported types are `AgentPermissionRequest`, `AgentQuestionRequest`, and
`AgentQuestion`.

- A **permission** request has `title` (e.g. `bash: rm -rf dist`), `permission`, `patterns`, and
  `always`. Reply `{ type: "permission", response: "once" | "always" | "reject" }`.
- A **question** request has `questions[]`, each with a `key`, `header`, `question`,
  `options[{ label, description }]`, `multiple`, and `custom`. Reply with the selected option
  **labels** keyed by question `key`, or one free-text string when `custom` is true:
  `{ type: "question", answers: { [question.key]: string[] } }`. Every question needs an entry.
  Or dismiss all of them with `{ type: "question", reject: true }`.

The quick start above shows a complete relay. Rejecting a permission or dismissing a question
ends the turn: OpenCode records a failed tool call and the run finishes. A run left
`awaiting_input` does not keep its workspace awake; if nobody answers before the workspace's
idle timeout pauses it, the run is cancelled with `"Workspace paused while waiting for input"`.
To avoid prompts entirely in headless runs, allow the relevant tools in
`opencode.config.permission` when creating the workspace.

### Transcript

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

The lifecycle stream does not mirror OpenCode's native message, tool, or token events. For live
execution details, use `workspaces.getRuntimeAccess()` with the official OpenCode SDK.

### Continuing context

Runs are isolated by default and can execute in parallel. To preserve conversational context,
continue a terminal run; continued runs sharing context must remain sequential:

```ts
const next = await client.runs.create({
  workspace,
  idempotencyKey: "onboarding-tests-v1",
  prompt: "Now add tests for that change.",
  context: { type: "continue", run: completed },
});
```

`runs.cancel(run)` aborts the current run; a run that is `awaiting_input` has its pending
prompt rejected first. GitTerm keeps the underlying OpenCode session private.

## Model provider credentials

Model selection and credential selection are separate decisions, grouped under `models`:

```ts
const { workspace } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  models: {
    default: "openai/<model-id>",
    inherit: "none", // only the providers listed here receive credentials
    providers: {
      openai: { source: "saved", label: "work" },
      anthropic: { source: "default" },
      google: { source: "apiKey", apiKey: process.env.GOOGLE_API_KEY! },
    },
  },
});

const run = await client.runs.create({
  workspace,
  model: "anthropic/claude-sonnet-4-20250514",
  prompt: "Record before/after videos of the changes in PR #42",
});
```

**Saved credentials use labels, not IDs.** Choose `{ source: "saved", label: "work" }` or
`{ source: "default" }`. Provider keys are logical model providers: use `openai` for both OpenAI
API keys and saved ChatGPT subscriptions, not `openai-oauth`. `credentials.list()` returns labels
and `logicalProviderKey`, never secrets. If an API key and subscription share the same label,
selection fails explicitly; give them distinct dashboard labels. Discovery requires `workspace:write`.

**Inline credentials** use `{ source: "apiKey", apiKey }` for this workspace only. A missing or
blank key fails validation; it never falls back to a saved credential. Keys are injected into
the sandbox, not saved in the dashboard. `credentials.listProviders()` includes each authentication
integration's `logicalProviderKey`. `models.list({ provider: "openai" })` discovers model IDs.
Managed OAuth credentials must be connected through the dashboard.

`workspaces.models(workspace)` shows which sources were configured and the matching catalog models.
It reads control-plane metadata only: it does not verify a key with the model provider, discover
custom runtime models, or resume a paused workspace. A saved credential's label/active status is
its current dashboard metadata.

Rules and errors:

- Omitting `models` uses dashboard defaults. An explicit `models` block defaults to
  `inherit: "none"`; `models: {}` injects no dashboard credentials.
- Use `inherit: "defaults"` to inherit every unlisted provider's dashboard default. Explicit
  sources override only their own provider. Each provider map key selects exactly one source.
- Unknown providers or inline keys for OAuth-only providers throw `MODEL_CREDENTIAL_INVALID`.
  A missing or ambiguous label throws `MODEL_CREDENTIAL_UNAVAILABLE`.
- A run that requests a credential-backed `provider/model` not available in its workspace throws
  `MODEL_CREDENTIAL_REQUIRED` before the prompt is submitted.

`models.default` sets the workspace's agent default; `runs.create({ model })` overrides the model
for that run. Credentials remain workspace-scoped: changing credentials for one concurrent run
would otherwise change them for other runs on the same runtime.

## OpenCode API versions

Managed workspaces continue to run `opencode-ai@latest` (`opencodeApi: "v1"`). OpenCode 2
changes the server API; callers testing it must supply their own compatible image and create the
workspace with `opencode: { api: "v2" }`. Runs, questions, permissions, and events behave the
same from the SDK's point of view; the flag only tells GitTerm which protocol to speak to the
workspace. `v2` is experimental until OpenCode 2 ships.

## Errors

Managed methods and the shared run APIs throw `GittermError` with a stable `code`; never match on messages.
Direct provider lifecycle/authentication methods may also propagate provider errors.

```ts
import { GittermError, WorkspaceLifecycleError } from "@gitterm/sdk";

try {
  await client.runs.create({ workspace: workspaceId, prompt });
} catch (error) {
  if (error instanceof WorkspaceLifecycleError && error.code === "WORKSPACE_NOT_RUNNING") {
    await client.workspaces.ensureRunning(workspaceId); // paused; resume and retry
  } else if (error instanceof GittermError && error.code === "TIMEOUT") {
    // the wait elapsed; the run itself may still be going
  } else throw error;
}
```

Workspace lifecycle failures are `WorkspaceLifecycleError` with codes `WORKSPACE_NOT_RUNNING`,
`WORKSPACE_TERMINATED`, `WORKSPACE_NON_RECOVERABLE`, `WORKSPACE_START_TIMEOUT`, and
`WORKSPACE_RESTART_FAILED`. Credential failures use the `MODEL_CREDENTIAL_*` codes listed above.
General codes are `NOT_LOGGED_IN`, `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`,
`CONFLICT`, `SERVER_ERROR`, `NETWORK`, `TIMEOUT` (a `timeoutMs` elapsed), and `ABORTED` (a wait
was cancelled through its `signal`).

The package ships self-contained declarations from `dist`; TypeScript consumers do not
need GitTerm's API package or tRPC server types.

## Versioning

`@gitterm/sdk` follows semver. Before 1.0, a minor bump (`0.1` → `0.2`) may contain breaking
changes and lists them in [CHANGELOG.md](./CHANGELOG.md) with a migration note; patch releases
never change public types or behaviour. Pin `~0.2.0` if you want patches only.

## Obtaining a token programmatically

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
  models: {
    providers: { anthropic: { source: "apiKey", apiKey: process.env.ANTHROPIC_API_KEY! } },
  },
});

try {
  const run = await direct.runs.create({ workspace, prompt: "Review the open pull request" });
  const completed = await direct.runs.result(run);
  console.log(completed.finalText);
} finally {
  workspace = await direct.workspaces.terminate(workspace);
}
```

`DirectWorkspace` and `DirectRun` are JSON-serializable. A direct run carries its workspace runtime
access, so `get`, `watch`, `events`, `wait`, `result`, `respond`, `messages`, and `cancel` take just
the run, exactly as in managed mode. Persist the complete run to reattach after a process restart;
continue a completed run with `context: { type: "continue", run: completed }`. After resuming a
workspace, update a persisted run's `workspace` with the returned workspace before reattaching.
Direct mode does not provide managed durable run storage or submission idempotency.
Serialized workspaces/runs contain runtime credentials: encrypt them and never send them to an
untrusted UI. Custom providers can implement `DirectProviderAdapter`; inspect `client.provider.capabilities`.

Both modes default to OpenCode **v1** and share v1/v2 run, permission, question, and SSE adapters.
For direct v2, supply a compatible provider image/template and `opencode: { api: "v2" }` at workspace
creation. The flag chooses the protocol; it does not install or upgrade the runtime. Direct mode
does not accept saved/dashboard credential sources or `inherit: "defaults"`.

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

Direct **v2** workspaces can start OpenCode provider authentication without shell access. This
connection-management API is v2-only; v1 supports inline API keys/OAuth bundles at creation and
`auth.setCredential()`. Discover a headless/device-code method for remote authentication:

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
  models: {
    providers: {
      openai: {
        source: "oauth",
        refreshToken: credential.refreshToken,
        accessToken: credential.accessToken,
        expiresAt: credential.expiresAt,
        accountId: credential.accountId,
      },
    },
  },
});

// v1 credentials can also be added or rotated on an existing runtime.
// On v2, setCredential supports API keys; use connectOAuth for OAuth rotation.
await direct.auth.setCredential(workspace, {
  source: "oauth",
  providerName: "openai",
  refreshToken: credential.refreshToken,
  accessToken: credential.accessToken,
  expiresAt: credential.expiresAt,
});
```

In this mode the application owns encryption, tenant scoping, refresh, and persistence. OpenCode may refresh its workspace-local copy; the direct SDK does not copy rotated tokens back into application storage. Use the Gitterm control plane when those credential-management responsibilities should be managed centrally.

## License

MIT

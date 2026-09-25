# Changelog

`@gitterm/sdk` follows semver. Before 1.0, a minor bump (`0.x` → `0.y`) may contain breaking
changes and is listed under **Breaking** below; patch releases never change public types or
behaviour you could have relied on.

## 0.6.1

### Fixed

- The client keeps the server URL's base path when building the tRPC endpoint, so
  `serverUrl: "https://<host>/api"` (self-hosted behind the path-routing proxy) calls
  `https://<host>/api/trpc` instead of `https://<host>/trpc`. The workspace client and
  `loginWithDeviceCode()` resolve their routes the same way. A base that already ends in `/trpc`
  or `/api` is not doubled, and the hosted default is unchanged.

## 0.6.0

### Breaking

- Removed `client.models.list()` and the `ModelInfo` type. GitTerm no longer keeps a model catalog;
  pass OpenCode `provider/model` IDs directly.
- `client.workspaces.models(workspace)` returns only `providers`; the `models` field is removed.

### Added

- Workspace ports have a `visibility` of `"private"` (default; only the owner's signed-in GitTerm
  browser session) or `"public"` (anyone with the URL, for APIs and webhooks).
  `workspace.ports.open(port, { visibility })` sets it on open, and
  `workspace.ports.setVisibility(port, visibility)` changes it later. `WorkspacePort.visibility` is
  returned from `list()`, `open()`, and `self.get()`.

## 0.5.0

### Breaking

- OpenCode 2 only. `Workspace.opencodeApi`, `DirectWorkspace.opencodeApi`, the `OpencodeApi` type, and
  `opencode.api` on workspace creation inputs are removed; every workspace speaks the OpenCode 2
  `/api/*` API and images/templates must ship `@opencode/cli`.
- Model credentials are provisioned through `~/.gitterm/opencode/credentials.json` plus the
  `gitterm-credentials` OpenCode plugin instead of `auth.json`. When `models` is omitted or
  `inherit: "defaults"`, every saved account of the user travels with the workspace (not only the
  defaults), labelled as in the dashboard; the dashboard default is the active account.
- Direct inline credentials accept an optional `label` shown in OpenCode.
- `direct.auth.setCredential()` accepts API keys only; use `connectOAuth()` for OAuth.
- Attach with `OPENCODE_PASSWORD=<password> opencode --server <url>`; `opencode attach` no longer exists.

## 0.4.0

### Breaking

- Restored OpenCode V1 as the default for managed and direct workspace operations.
- Restored V1 `auth.json` credential provisioning and `opencode attach` connection commands.

## 0.2.2

### Fixed

- Question options are normalised at the runtime boundary: a copied 'Type your own answer' entry becomes `custom: true`, duplicates and blank labels are dropped.
  Hosted users need the API redeployed for this to take effect.

## 0.2.1

### Fixed

- Questions without an explicit `custom` flag now accept free-text answers, matching OpenCode's
  default. Previously such questions could not be answered at all.

## 0.2.0

### Breaking

- Replace `modelCredentials` arrays with `models: { default?, inherit?, providers }`.
  Saved credentials use `{ source: "saved", label }`, defaults use `{ source: "default" }`,
  and inline keys use `{ source: "apiKey", apiKey }`. Keys in `providers` are logical model
  providers (`openai` also selects saved ChatGPT subscriptions). An explicit models block
  inherits nothing unless `inherit: "defaults"` is requested; omitting models retains dashboard defaults.
- `runs.create()` takes `workspace` in both modes. Continue with `context: { type: "continue", run }`.
  Direct runs carry runtime access and all follow-up methods take only the run, not a second workspace.
  Encrypt persisted direct runs; they contain workspace credentials.
- Direct runs now expose the same status/input/result contract and SSE observation as managed runs.
  `cancel()` returns `{ cancelled }`; direct polling wait options are removed.
- Request `createdAt` is null when the runtime does not provide it, rather than a new timestamp
  on every snapshot. Runtime OAuth connection management is explicitly v2-only.
- Run methods take a `RunRef` only: an `AgentRun`, or any `{ workspaceId, id }` object. The
  `(workspaceId, runId)` overloads and the `{ workspaceId, runId }` ref shape are gone.
  Migration: `runs.wait(workspace.id, run.id)` → `runs.wait(run)` or
  `runs.wait({ workspaceId, id: runId })`.
- Question answers are keyed by question `key` instead of positional:
  `{ type: "question", answers: { [question.key]: string[] } }`.
- `AgentQuestionOption` no longer exposes `value`. Replies were always matched by `label`; the
  field only suggested otherwise.
- Timeouts reject with code `TIMEOUT` (previously `NETWORK`): `runs.wait({ timeoutMs })`,
  `workspaces.waitForSetup()`, and `runs.create({ waitForSetup })`.

### Added

- `runs.result(run, { onPermission?, onQuestion?, timeoutMs?, signal? })`: successful terminal
  results with subscriber-local input deduplication and deadlines that include handler time.
  `AgentRunError` retains the run for `INPUT_REQUIRED`, `RUN_FAILED`, and `RUN_CANCELLED`.
- `runs.events()` exposes actionable input-required/resolved and terminal events. Stale responses
  report `INPUT_NOT_PENDING`; responses are not promised to be exactly-once or idempotent.
- `models.list()` for model discovery and `logicalProviderKey` in provider metadata.
- `workspaces.models()` for read-only credential-source and catalog-model discovery.
- Direct workspaces accept `opencode.api: "v1" | "v2"`, defaulting to v1.
- `runs.watch(run, { signal })`: an `AsyncIterable<AgentRun>` of every lifecycle state, ending
  after the terminal one. `runs.wait()` is now a thin helper over it.
- Exported leaf types `AgentPermissionRequest`, `AgentQuestionRequest`, `AgentQuestion`,
  `AgentQuestionOption`, `RunRef`, and `RunWatchOptions`.

### Changed

- Shared v1/v2 runtime adapters and completion rules for managed and direct runs. Intermediate
  assistant tool steps no longer count as completed runs.
- Fixed server validation for all permission/question reply forms, stable request snapshots,
  and atomic removal of answered inputs when responses reach different server replicas.

## 0.1.3

- Workspace automation APIs: `metadata`, `autoTerminateAfterMs`, `image`, `secretFiles`,
  `additionalAgentInstructions`, `opencode.{skills,plugins,config,api}`; `modelCredentials`
  selected by `providerName` + `label` instead of credential id; `WorkspaceLifecycleError`.

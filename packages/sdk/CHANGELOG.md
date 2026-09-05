# Changelog

`@gitterm/sdk` follows semver. Before 1.0, a minor bump (`0.x` → `0.y`) may contain breaking
changes and is listed under **Breaking** below; patch releases never change public types or
behaviour you could have relied on.

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

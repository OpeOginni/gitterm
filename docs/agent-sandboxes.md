# Agent sandboxes

A local agent can run builds, tests, and preview servers in a remote sandbox while the
conversation and the checkout stay on your machine. This is separate from `/cloud`, which
moves the conversation and checkout into a remote OpenCode workspace.

A sandbox runs no coding agent and receives no model credentials. It only gets the
source you sync and the commands you run. Sandboxes use plain images (for example
`node:22-bookworm-slim`). The one exception is Boat: its base image cannot be replaced and
includes an `opencode` binary, which is never started.

## Modes

| Mode                      | Who runs the provider account | Who pays                                        | Needs a Gitterm account |
| ------------------------- | ----------------------------- | ----------------------------------------------- | ----------------------- |
| `managed`                 | The Gitterm deployment        | Your Gitterm plan (usage sessions, plan limits) | Yes                     |
| `direct` (bring your own) | You                           | Your provider account                           | No                      |

Each sandbox reference carries its mode, provider, and account name
(`{ mode, provider, account, id }`). A reference from another mode or account fails with
`SandboxAccountError`. A rejected or missing credential is an error too. Gitterm never
falls back to another mode or account.

## Supported providers

Cloudflare is not supported yet and is planned for later. AWS is managed-only, because it
runs on the deployment's ECS cluster and load balancer.

| Provider | managed | direct                             | Image                                    | Abandoned sandbox                                             | Previews                                           |
| -------- | ------- | ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| E2B      | Yes     | Yes                                | `base` template                          | Deleted at the lifetime (`onTimeout: kill`)                   | Private (access header)                            |
| Daytona  | Yes     | Yes                                | `node:22-bookworm-slim`                  | Deleted at the lifetime (`ttlMinutes`)                        | Private (access header)                            |
| Vercel   | Yes     | Yes                                | `node24` runtime                         | Stopped at the timeout; files discarded                       | Public URL only                                    |
| Boat     | Yes     | Yes                                | Boat base (includes `opencode`, unused)  | Stopped and archived at the TTL; storage kept until destroyed | Private (`_port_auth` cookie)                      |
| exe.dev  | Yes     | Yes, with `allowUnboundedLifetime` | `node:22-bookworm`                       | Never deleted by the provider                                 | Private (VM key), ports 3000-9999                  |
| Railway  | Yes     | Yes, with `allowUnboundedLifetime` | `node:22-bookworm-slim` + command server | Never deleted by the provider                                 | Private (command-server token); port 8080 reserved |
| AWS      | Yes     | No                                 | `node:22-bookworm-slim` + command server | Never deleted by the provider                                 | Private (command-server token); port 8080 reserved |

In managed mode the Gitterm worker terminates every sandbox at its lifetime
(`autoTerminateAt`), whatever the provider does. In direct mode only the provider can
clean up after a crashed caller. For exe.dev and Railway, which never do, the account
must set `"allowUnboundedLifetime": true` to accept that a crash leaves the sandbox
running and billing. Otherwise creation is refused.

Railway and AWS have no command API. A stock Node image runs a small Gitterm command
server as its start command; it is not an agent. It runs `sh -c`, reads and writes
files, and forwards preview requests carrying `x-gitterm-port`, all only for requests
with the `x-gitterm-token` header. The token is an HMAC of the provider credential (AWS:
the deployment's encryption key) and the sandbox name. It is derived when needed and
never stored.

Provider limits that change behaviour:

- **Vercel:** five tags per sandbox, so the purpose and session labels may be dropped.
- **Boat:** no labels, and files of at most 5 MiB returned per read.
- **exe.dev:** no labels, 30 s and 64 KB per API request. Jobs launch detached; uploads are chunked and slow for large sources.
- **Boat and exe.dev:** the owning account is kept as a hash in the sandbox name, because there are no labels.

## Operations

Shared code lives in `@gitterm/sdk/sandbox` and is used by both the CLI and the OpenCode
plugin:

- Create, list (reconciled with the provider), and destroy, with the provider confirming deletion.
- Source sync: upload a snapshot of the checkout and verify it in the sandbox.
- Durable jobs: status, bounded logs paged by byte offset, and cancellation.
- Previews with a readiness check. Private previews also get an optional loopback proxy.
- Artifacts: download with hash verification, plus a separate apply step that refuses stale targets.

Every operation is built on a few provider primitives: run a short command, write a
file, read a file, and get a preview URL. Each provider implements them once, in
`packages/agent-runtime/src/sandbox/`. In direct mode they run locally with your
credential. In managed mode the same code runs on the server behind the `sandbox.*` API,
with the deployment's credential.

Managed sandboxes are stored as `sandbox:<provider>:<id>` handles. The provider lookup
used by the termination queue, idle reaper, restart, and activity keep-alive sends those
handles to the sandbox code, so the existing lifecycle applies unchanged.

### Jobs

`exec` starts a job and returns its id: `job_` followed by 20 hex characters. The job's
state lives in the sandbox under `~/.gitterm/jobs/<id>` (the provider's command user):

- the command
- the start and finish times
- the exit code
- cancel and timeout markers
- the process group id
- the combined output log

A new process, for example after a plugin restart, can reattach by id. The local record
also keeps the snapshot id and digest the job ran on.

- **A job is its process group.** The timeout watchdog and cancellation signal the whole group (`TERM`, then `KILL`). When the command exits, anything it left running in the background is stopped too, so nothing outlives the job or its deadline. Run long-lived servers in the foreground of their own job (as `preview` does). `processAlive` reports whether any non-zombie process of the group is still running, and cancel keeps signalling until the group is gone.
- **Statuses:** `running`, `succeeded`, `failed`, `timed_out`, `cancelled`, or `lost`. `lost` means the runner died without recording an exit, for example after the sandbox restarted.
- **Command failure vs provider failure:**
  - A non-zero exit is a `failed` job with its exit code.
  - A provider or API failure is a thrown `SandboxProviderError`, with code `auth`, `not_found`, `rate_limited`, `timeout`, or `provider`.
- **Model-visible output** is the last 8 KiB of the log by default. Earlier output is read with `offset`/`limit`.
- **Secrets in output:** values passed through `env` are replaced with `[redacted]` inside the sandbox, line by line, before output is stored. Every reader sees only redacted text: a restarted plugin, another CLI process, or a paged read that would otherwise cut a value in half. Local records keep only the variable names. Because redaction works per line, values with line breaks (for example PEM keys) and values shorter than 4 characters are refused before anything is sent; base64-encode multi-line values and decode them in the command.
- **Output sanitizing:** control characters and terminal escapes are stripped before output is returned.
- **Plugin output** is wrapped in an `untrusted` block that tells the model to treat it as data.

### Source snapshots

`captureSource()` reads the working tree as it is on disk:

- committed, staged, and unstaged changes
- non-ignored untracked files
- binary files and the executable bit
- symlinks

Tracked files deleted locally are absent from the snapshot and are deleted in the
sandbox if an earlier snapshot put them there. Git history and the conversation are not
uploaded.

Excluded and reported:

- secret-like names (`.env*` except examples, `.npmrc`, `.netrc`, `.pypirc`, keys, `*.pem`, `*.p12`, `*.pfx`, `*.key`, `credentials.json`)
- files containing private-key blocks
- paths matching the configured `exclude` globs

Submodules, unresolved merge conflicts, and sources over 100 MiB are rejected.

The snapshot id is `snap_` plus the first 16 hex characters of a sha256 over the sorted
manifest (`kind sha256 path` per file). The upload is a tar.gz built in process. In the
sandbox it is extracted to a staging directory and every file is checked with
`sha256sum`. Only then is it copied into `~/project` and checked again. Ignored
build output from earlier runs (for example `node_modules`) stays in place.

### Artifacts

`fetchArtifact(ref, path, { jobId })` downloads one file a job produced into
`$XDG_CACHE_HOME/gitterm/sandbox-artifacts/...`, outside the checkout. It compares the
download with a sha256 computed in the sandbox and records the artifact with its job.
The limit is 64 MiB in direct mode and 32 MiB in managed mode; managed mode checks the
size before reading the file into server memory.

`applyArtifact(ref, { localPath, target })` writes a fetched file into the checkout the
producing job's snapshot came from. The baseline is that job's snapshot, not the latest
sync, so applying an old build cannot overwrite newer local work. It refuses when:

- the target changed locally since that snapshot, or appeared since then
- the target or any parent directory is a symlink or not a regular file or directory, so writes cannot escape the checkout
- the downloaded file changed since it was verified

The exact verified bytes are written, and the parent is checked again just before the
final rename. Snapshot manifests are stored per checkout, so two checkouts with
identical content keep separate baselines.

### Previews

`preview()` optionally starts a server command as a job, then polls the port for up to
60 s. The provider edge answers 502 until something listens. The result also reports the
status of a request made without the access header.

- **Private (default where the provider allows it):** without the access header the provider answers 401 or 403 (E2B, Daytona, Boat, and the command server; see the provider table). Give it to tools through the loopback proxy (`startPreviewProxy`, the plugin's `localProxy`, or `gitterm sandbox preview --serve`), never to a model. Each preview gets its own hostname, `p-<random>.localhost` (browsers and Node resolve it to loopback), served from `/`, so root-relative assets and client-side routes work. Cookies are scoped by host, so the preview's cookies and its JavaScript never see those of other local apps or other previews, and the app's own cookie names keep working. Opening the returned URL exchanges its one-time token for an HttpOnly cookie; requests without it get 401, and requests for any other host (including plain `127.0.0.1`) get 421. Requests always go to the provider's host: a path that normalizes to `//other-host/...` cannot redirect the access headers. The proxy lasts as long as the process. It does not carry WebSockets.
- **Public:** chosen at creation (`publicPreviews`) and fixed for the sandbox's life, because E2B cannot change it later. It needs a separate approval. Vercel only has public URLs, so Vercel previews require this approval too.

Closing the plugin closes its proxies only. Sandboxes and their preview servers keep
running until destroyed or until their lifetime ends.

## Credentials

| Mode            | Where the credential lives                                                                                                                                         | Which process uses it                          | Who receives it          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------ |
| direct (plugin) | Plugin options in `opencode.json(c)`. Write `"apiKey": "{env:E2B_API_KEY}"` or `"{file:~/.secrets/e2b}"`; OpenCode substitutes the value when it loads the config. | The OpenCode server process running the plugin | that provider's API only |
| direct (CLI)    | The environment variable named by `apiKeyEnv` in `~/.config/gitterm/sandbox.json`. The file holds names only; a literal `apiKey` or `token` in it is refused.      | The `gitterm` process                          | that provider's API only |
| managed         | The deployment's provider config, encrypted in the Gitterm database. You hold only your Gitterm API token (CLI login or `GITTERM_API_TOKEN`).                      | The Gitterm API server                         | that provider's API only |

The following never contain credentials:

- **Local records** in `$XDG_STATE_HOME/gitterm/sandboxes` (default `~/.local/state/...`), mode 0600. They hold the sandbox reference, account name, project path, session id, snapshot id and digest, job commands and statuses, and the names (not values) of variables passed to jobs.
- **Snapshot manifests**, which hold paths and hashes only.
- **Archives, artifacts, logs, and tool results.**

Preview access headers stay in memory. Values from `secretEnv` are written to a 0600
file inside the sandbox for that job, never passed on a command line. A literal key typed
into `opencode.json` instead of `{env:...}` is your choice and lives in that file. Avoid
it.

## Charges, lifetime, and cleanup

**Direct.**

- The provider bills your account while the sandbox exists. Age is shown as wall-clock time.
- Where the provider can, the sandbox is created with its own deadline: E2B `onTimeout: "kill"`, Daytona `ttlMinutes`, Vercel `timeout` without persistence, and Boat `ttlSeconds` (which archives rather than deletes). See the provider table for exe.dev and Railway.
- E2B reconnects pass only the remaining time, so a reconnect cannot extend the deadline.
- A failure after the provider created the sandbox deletes it before the error returns.
- Direct sandboxes are listed only from the provider, with no central Gitterm inventory. Run `list` per account.

**Managed.**

- A sandbox is a `workspace` row on the disabled `sandbox` agent type (migration `0044`), with a `sandbox:<provider>:<id>` handle. It is billed at the provider's default machine profile.
- Creation checks plan entitlements, including which providers the plan may use, plus the run allowance and the workspace limit, which counts sandboxes too. The limit is checked under a per-user database lock together with the insert, so concurrent creates cannot exceed it. The same applies to ordinary workspace creation.
- A usage session runs while the sandbox is running.
- API calls count as activity. When idle, the sandbox is paused after the plan's idle timeout, by the provider where it supports idle stops and by the worker otherwise. A paused sandbox keeps its files on E2B, Daytona, Vercel (persistent snapshot), Boat, and exe.dev. On Railway and AWS a pause discards files and processes. Paused time is not billed as active. `resume()` (plugin `sandbox_resume`, CLI `gitterm sandbox resume`) goes through the normal restart quota check. After resuming on Railway or AWS, sync again: earlier files and jobs are gone.
- Provider lifecycle webhooks (E2B, Daytona, Railway, Boat) recognize sandbox handles, so a provider-initiated pause settles status and usage. For providers without webhooks, `get` asks the provider and settles a sandbox it paused or deleted.
- At `autoTerminateAt` (the requested lifetime) the worker terminates the sandbox whether or not anyone is connected. Termination deletes it at the provider and closes the usage session.

Explicit `destroy` checks with the provider afterwards and reports `terminated` only
when the provider confirms it. In managed mode, termination is queued before the provider
is called. If deletion fails, the sandbox reports `deleting` (`deleted: false`), the worker
retries from the queue, and calling `destroy` again retries immediately. Deletion counts
as done only when the provider reports the sandbox gone (polled for up to 30 s, since some
providers accept a deletion and finish it later); only then is the provider handle cleared.
When `get` finds that the provider deleted a sandbox on its own, billing stops but the
handle is kept and a confirmed cleanup is queued. Provider errors, such as a permission
failure, are never treated as a deletion.

## Configuration

OpenCode plugin options:

```jsonc
{
  "plugins": [
    {
      "package": "@gitterm/opencode-plugin",
      "options": {
        "sandbox": {
          "account": "e2b",
          "accounts": {
            "e2b": { "mode": "direct", "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
            "gitterm": { "mode": "managed" },
          },
          "limits": {
            "maxSandboxes": 2,
            "maxLifetimeMinutes": 60,
            "defaultLifetimeMinutes": 30,
            "maxJobMinutes": 30,
          },
          "exclude": ["fixtures/large/**"],
        },
      },
    },
  ],
  // Approve routine work once; keep public sharing denied.
  "permissions": [
    { "action": "gitterm.sandbox.provision", "resource": "direct:e2b:e2b", "effect": "allow" },
    { "action": "gitterm.sandbox.exec", "resource": "direct:e2b:*", "effect": "allow" },
    { "action": "gitterm.sandbox.public", "resource": "*", "effect": "deny" },
  ],
}
```

The CLI reads the same shape from `~/.config/gitterm/sandbox.json` (or
`GITTERM_SANDBOX_CONFIG`), with `apiKeyEnv` instead of `apiKey`.

### Plugin permissions

| Action                      | Resource                           | Asked when                                                                           |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `gitterm.sandbox.provision` | `<mode>:<account>:<provider>`      | Creating a sandbox                                                                   |
| `gitterm.sandbox.public`    | `<mode>:<account>`                 | Creating with public previews. "Always" is not offered.                              |
| `gitterm.sandbox.upload`    | `<mode>:<account>:<checkout root>` | Syncing. The prompt lists modified, untracked, deleted, and excluded files.          |
| `gitterm.sandbox.exec`      | `<mode>:<account>:<sandbox id>`    | Running a command or starting a preview server. "Always" saves `<mode>:<account>:*`. |
| `gitterm.sandbox.secret`    | variable names                     | Passing local environment variables through `secretEnv`                              |
| `gitterm.sandbox.browser`   | `<mode>:<account>:<id>:<port>`     | Creating a loopback proxy for a private preview                                      |
| `gitterm.sandbox.apply`     | target path                        | Writing an artifact into the checkout. "Always" is not offered.                      |

Listing sandboxes, reading jobs and logs, cancelling, downloading artifacts into the
staging directory, and destroying need no approval. A denied action stops before any
upload, provisioning, or local write.

## Verification

```sh
# Unit and Docker-backed tests (no provider spend). The Docker suite runs twice: through
# `docker exec`, and through the command server that Railway and AWS sandboxes use.
bun test packages/sdk/src/sandbox
GITTERM_SANDBOX_DOCKER_TESTS=1 bun test packages/sdk/src/sandbox/docker.test.ts

# Managed API against a disposable local database (provider faked).
URL=postgresql://postgres:password@localhost:5432/gitterm
ENABLE_USAGE_METERING=true DATABASE_URL=$URL SANDBOX_DATABASE_TEST_URL=$URL \
  bun test packages/api/src/routers/sandbox.integration.test.ts

# Live smoke test (billable). The settings file uses apiKeyEnv / GITTERM_API_TOKEN, never literal keys.
GITTERM_SANDBOX_CONFIG=./sandbox.json bun run scripts/sandbox-smoke.ts --account <name> [--crash]
```

The smoke script creates an isolated fixture repository whose uncommitted edit changes
the test result. It also contains an untracked file, a deleted tracked file, a binary
file, and a `.env` with a sentinel value. Every sandbox the run created is destroyed in
`finally`, with the provider confirming; providers without labels are tracked by id. It
checks:

- that no agent runs and no model credential is present, and that no agent CLI is installed (Boat: reported, since its base image has one)
- the snapshot digest
- a non-zero exit, a timeout, and oversized output
- reattaching after a client restart, and cancelling
- the preview: rejected without the access header (401/403), or reported as an open URL on Vercel
- binary artifact hashes and secret redaction
- that the local checkout is unchanged
- deletion confirmed by the provider
- with `--crash`, that the provider deletes (Boat: archives) a sandbox whose creator was SIGKILLed. Skipped for providers that never clean up.

It ends with a scan for leaked keys in local state.

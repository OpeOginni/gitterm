---
title: Sandbox tools
nav: Tools
description: Every sandbox_* tool the sandbox plugin gives your agent, with its arguments.
---

This is the reference for the `sandbox_*` tools that `@gitterm/opencode-sandbox` adds to your local agent. You never call these yourself: you ask in plain words, and the agent picks the tools and arguments. Use this page to read what the agent did, or to write instructions for it. The tools work only after you add a sandbox account; see [Setup](/docs/sandboxes/setup).

Every tool except `sandbox_create` and `sandbox_list` takes a `sandboxId`, from `sandbox_create` or `sandbox_list`. A sandbox belongs to the account that created it. Using it while another account is selected is an error. A managed sandbox that paused while idle resumes when a tool next uses it; see [Pausing](/docs/sandboxes/providers#pausing-managed-only).

Sandbox output is wrapped in an `untrusted` block that tells the model to treat it as data, not instructions.

| Tool                                    | What it does                                                      | Asks for approval                      |
| --------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| [`sandbox_create`](#sandbox_create)     | Creates a sandbox                                                 | Yes                                    |
| [`sandbox_list`](#sandbox_list)         | Shows the selected account, who is charged, limits, and sandboxes | No                                     |
| [`sandbox_sync`](#sandbox_sync)         | Uploads the current working tree                                  | Yes                                    |
| [`sandbox_exec`](#sandbox_exec)         | Runs a command as a job                                           | Yes                                    |
| [`sandbox_job`](#sandbox_job)           | Reads a job's status and output, or cancels it                    | No                                     |
| [`sandbox_preview`](#sandbox_preview)   | Exposes a port, optionally starting a server                      | If it starts a server or a local proxy |
| [`sandbox_artifact`](#sandbox_artifact) | Downloads a file to a staging directory                           | No                                     |
| [`sandbox_apply`](#sandbox_apply)       | Copies a downloaded file into the checkout                        | Yes, every time                        |
| [`sandbox_destroy`](#sandbox_destroy)   | Deletes a sandbox                                                 | No                                     |
| [`sandbox_snapshot`](#sandbox_snapshot) | Saves or deletes a setup snapshot (with the `snapshots` option)   | Yes                                    |

The approval actions and how to pre-approve them are in [Setup](/docs/sandboxes/setup#approvals).

## sandbox_create

Creates a sandbox. Billing starts now. No coding agent runs in it.

| Argument          | Type    | Required | Default                                   | What it does                                                                                                                                                                                                                                                                                          |
| ----------------- | ------- | -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | string  | No       | `OpenCode sandbox`                        | Display name.                                                                                                                                                                                                                                                                                         |
| `purpose`         | string  | No       | None                                      | Why it exists, for example `run integration tests`.                                                                                                                                                                                                                                                   |
| `lifetimeMinutes` | integer | No       | `defaultLifetimeMinutes` (30)             | When the sandbox ends. At most `maxLifetimeMinutes`.                                                                                                                                                                                                                                                  |
| `publicPreviews`  | boolean | No       | The `publicPreviews` option, else `false` | Makes every preview reachable by anyone with the URL. Fixed for the sandbox's life. Needs a separate approval unless the plugin's `publicPreviews` option is on. Has no effect where previews are always private; see [Previews by provider](/docs/sandboxes/jobs-and-previews#previews-by-provider). |
| `snapshot`        | string  | No       | The newest snapshot for this checkout     | Only with the `snapshots` option. A setup snapshot id from `sandbox_list` to start from, or `none` for a clean sandbox.                                                                                                                                                                               |

Creation fails when the account already has `maxSandboxes` live sandboxes. What happens at the end of the lifetime depends on the account and provider; see [Providers](/docs/sandboxes/providers).

## sandbox_list

Shows the selected account and its live sandboxes, checked against the provider. No arguments.

- For the account: the mode, account, and provider, where the key comes from and whether it is present, who is charged, the limits, and the provider's limitations. It never shows the key.
- For each sandbox: state, age, expiry, who is billed, the last synced snapshot, running jobs, and previews.

## sandbox_sync

Uploads the session's working tree as it is on disk to `~/project` in the sandbox. This includes uncommitted changes and untracked files that are not ignored. Files you deleted locally are deleted there too. Your local files do not change.

| Argument    | Type   | Required | Default | What it does    |
| ----------- | ------ | -------- | ------- | --------------- |
| `sandboxId` | string | Yes      | None    | Target sandbox. |

- The approval prompt lists modified, untracked, deleted, and excluded files.
- The result shows the snapshot id and sha256 digest, and confirms the files were verified in the sandbox.
- Ignored files already in the sandbox, such as `node_modules` from an earlier install, stay in place.
- It refuses a checkout over 100 MiB, with submodules, or with unresolved merge conflicts. It needs a Git checkout.

What is uploaded and what is always left out: [Security](/docs/sandboxes/security#what-a-sandbox-receives).

## sandbox_exec

Runs a shell command in the sandbox as a job. It returns when the job finishes or after `waitSeconds`, whichever comes first. A job that is still running keeps going; read it later with `sandbox_job`.

| Argument         | Type     | Required | Default                         | What it does                                                                     |
| ---------------- | -------- | -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `sandboxId`      | string   | Yes      | None                            | Target sandbox.                                                                  |
| `command`        | string   | Yes      | None                            | Shell command to run.                                                            |
| `cwd`            | string   | No       | `~/project`                     | Working directory, relative to `~/project` or absolute.                          |
| `timeoutMinutes` | number   | No       | 10, or `maxJobMinutes` if lower | Stops the job after this. At most `maxJobMinutes`.                               |
| `waitSeconds`    | integer  | No       | `60`                            | How long to wait before returning, 0 to 300.                                     |
| `secretEnv`      | string[] | No       | None                            | Names of local environment variables to pass to the job. Needs its own approval. |

The result shows the job id, status, exit code, the snapshot it ran on, and the last 8 KiB of output. A non-zero exit is a `failed` job, not a tool error.

Job statuses, timeouts, and how `secretEnv` values stay out of output: [Jobs and previews](/docs/sandboxes/jobs-and-previews#jobs).

## sandbox_job

Shows a job's status and part of its output, or cancels the job. It still works after OpenCode restarts.

| Argument      | Type    | Required | Default    | What it does                                        |
| ------------- | ------- | -------- | ---------- | --------------------------------------------------- |
| `sandboxId`   | string  | Yes      | None       | Target sandbox.                                     |
| `jobId`       | string  | Yes      | None       | Job id from `sandbox_exec` or `sandbox_preview`.    |
| `offset`      | integer | No       | Last 8 KiB | Byte offset in the log to start reading from.       |
| `limit`       | integer | No       | 8192       | Bytes to read, 1 to 65536.                          |
| `waitSeconds` | integer | No       | None       | Wait up to this long, 0 to 300, for the job to end. |
| `cancel`      | boolean | No       | `false`    | Cancels the job and everything it started.          |

Use either `waitSeconds` (wait, then show the last 8 KiB) or `offset` and `limit` (read a range). With `offset` set, `waitSeconds` is ignored. With `cancel` set, the job is cancelled and the others are ignored.

## sandbox_preview

Exposes a port in the sandbox and waits up to 60 seconds for it to answer. If you pass `command`, it starts that server as a job first.

| Argument     | Type    | Required | Default     | What it does                                                                                                  |
| ------------ | ------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `sandboxId`  | string  | Yes      | None        | Target sandbox.                                                                                               |
| `port`       | integer | Yes      | None        | Port to expose, 1 to 65535.                                                                                   |
| `command`    | string  | No       | None        | Server to start first, for example `npm run dev`. Needs the `exec` approval.                                  |
| `cwd`        | string  | No       | `~/project` | Working directory for `command`.                                                                              |
| `localProxy` | boolean | No       | `false`     | For a private preview, also returns a loopback URL that local browser tools can open. Needs its own approval. |

The result shows the URL, whether it is public or private, the status a request without access gets, and the server job id. The access header is never shown to the model.

Private and public previews, the local proxy, and provider port limits: [Jobs and previews](/docs/sandboxes/jobs-and-previews#previews).

## sandbox_artifact

Downloads one file a job produced into a local staging directory outside your checkout, and checks its hash. Your project files do not change.

| Argument    | Type   | Required | Default | What it does                                    |
| ----------- | ------ | -------- | ------- | ----------------------------------------------- |
| `sandboxId` | string | Yes      | None    | Target sandbox.                                 |
| `path`      | string | Yes      | None    | File path, relative to `~/project` or absolute. |
| `jobId`     | string | Yes      | None    | The job that produced the file.                 |

The result includes `localPath`, which `sandbox_apply` needs.

## sandbox_apply

Copies a downloaded file into your checkout. It refuses if the target changed locally since the job's snapshot.

| Argument       | Type   | Required | Default | What it does                                      |
| -------------- | ------ | -------- | ------- | ------------------------------------------------- |
| `sandboxId`    | string | Yes      | None    | The sandbox the file came from.                   |
| `artifactPath` | string | Yes      | None    | The `localPath` that `sandbox_artifact` returned. |
| `target`       | string | Yes      | None    | Path in the checkout, relative to its root.       |

When apply refuses and what to do: [Artifacts](/docs/sandboxes/artifacts#when-apply-refuses).

## sandbox_destroy

Deletes the sandbox. It reports the sandbox terminated only once the provider confirms it is gone, and closes any local preview proxies for it.

| Argument    | Type   | Required | Default | What it does       |
| ----------- | ------ | -------- | ------- | ------------------ |
| `sandboxId` | string | Yes      | None    | Sandbox to delete. |

## sandbox_snapshot

Saves a sandbox as a setup snapshot that new sandboxes can start from, or deletes one. The tool exists only when the `snapshots` option is on; see [Setup snapshots](/docs/sandboxes/setup#setup-snapshots).

| Argument          | Type    | Required  | Default | What it does                                                                                        |
| ----------------- | ------- | --------- | ------- | --------------------------------------------------------------------------------------------------- |
| `action`          | string  | Yes       | None    | `save` or `delete`.                                                                                 |
| `sandboxId`       | string  | To save   | None    | The sandbox to save.                                                                                |
| `label`           | string  | To save   | None    | Short name for what it holds, for example `deps + postgres`.                                        |
| `note`            | string  | No        | None    | What the sandbox has set up.                                                                        |
| `forThisCheckout` | boolean | No        | `true`  | Ties the snapshot to this checkout, so it is offered here and flagged when dependency files change. |
| `replace`         | string  | No        | None    | Id of a snapshot this one replaces. It is deleted once the new one is saved.                        |
| `snapshotId`      | string  | To delete | None    | The snapshot to delete.                                                                             |

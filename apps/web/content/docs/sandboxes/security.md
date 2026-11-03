---
title: Sandbox security
nav: Security
description: What a sandbox receives and never receives, where credentials live, how secrets are handled, and how cleanup and charges work.
---

This page lists what leaves your machine when your local agent uses a Gitterm sandbox, where provider keys live, and how sandboxes are cleaned up and charged. Read it before you approve your first sync, or when you choose between a [direct and a managed account](/docs/concepts#managed-and-direct-accounts).

## What a sandbox receives

- The working tree you sync with `sandbox_sync`: committed, staged, and unstaged changes, untracked files that are not ignored, binary files, the executable bit, and symlinks.
- The commands you run, and the values of variables you pass with `secretEnv`.

## What a sandbox never receives

- The conversation.
- Git history.
- Model credentials. No coding agent runs in the sandbox.
- Your provider key or Gitterm token.
- Untracked files that Git ignores, such as `node_modules` or build output.
- Secret-like files. `sandbox_sync` leaves these out and lists them in the approval prompt:
  - `.env` and `.env.*`, except `.env.example`, `.env.sample`, and `.env.template`
  - `.npmrc`, `.netrc`, `.pypirc`
  - SSH keys named `id_rsa`, `id_ed25519`, or `id_ecdsa` (with any extension)
  - `credentials` and `credentials.json`
  - `*.pem`, `*.p12`, `*.pfx`, `*.key`
  - any file containing a private-key block
  - paths matching your `exclude` globs

Secret detection uses file names and private-key markers. It is not a full secret scan, so review the file list before you approve a sync.

## Where credentials live

| Account         | Where the key lives                                                                                            | Who uses it                             | Sent to                  |
| --------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------ |
| Direct (plugin) | Plugin options, as `"apiKey": "{env:E2B_API_KEY}"` or `"{file:~/.secrets/e2b}"`. OpenCode fills it in at load. | The OpenCode process running the plugin | That provider's API only |
| Direct (CLI)    | The environment variable named by `apiKeyEnv`. The settings file holds names only.                             | The `gitterm` process                   | That provider's API only |
| Managed         | The deployment's provider config, encrypted in the Gitterm database. You hold only your Gitterm token.         | The Gitterm API server                  | That provider's API only |

Gitterm never stores a direct key, and never writes any key to sandbox records, snapshots, logs, or tool results.

> [!WARNING]
> A key typed directly into `opencode.json`, instead of `{env:...}` or `{file:...}`, lives in that file. Avoid it.

On Railway and AWS, the sandbox's command server accepts requests only with a token derived from the sandbox name and a key: your Railway token, or on AWS the deployment's encryption key. The token is derived when needed and never stored.

## What is stored locally

| What               | Where                                                                                       | Contains                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox records    | `$XDG_STATE_HOME/gitterm/sandboxes` (default `~/.local/state/gitterm/sandboxes`), mode 0600 | Sandbox reference, account name, project path, session id, snapshot id and digest, job commands and statuses, and names (not values) of variables passed to jobs |
| Snapshot manifests | `snapshots/` inside the sandbox records directory                                           | Paths and hashes only                                                                                                                                            |
| Artifacts          | The staging directory; see [Artifacts](/docs/sandboxes/artifacts)                           | Files you downloaded                                                                                                                                             |

None of these contain credentials. Preview access headers stay in memory.

## Secrets passed to jobs

`secretEnv` values never enter the conversation, are never put on a command line, and are replaced with `[redacted]` in output. Details and limits: [Passing secrets](/docs/sandboxes/jobs-and-previews#passing-secrets).

## Untrusted output

Anyone who can change your build can write text into its output. The plugin wraps sandbox output in an `untrusted` block that tells the model to treat it as data and not follow instructions in it.

## Cleanup

`sandbox_destroy` reports a sandbox as terminated only after the provider confirms it is gone. It checks for up to 30 seconds. If the provider has not confirmed by then, the tool returns an error; run `sandbox_destroy` again. For a managed sandbox, Gitterm also keeps retrying in the background, and the sandbox shows as `deleting` until the provider confirms.

If you forget a sandbox:

- **Managed:** Gitterm terminates it at its lifetime, even if your machine is offline.
- **Direct:** the provider ends it where it can. exe.dev and Railway never do. See [Providers](/docs/sandboxes/providers#cleanup-after-a-crash).

If creation fails after the provider made the sandbox, it is deleted before the error returns.

Direct sandboxes are listed only from the provider; there is no central Gitterm list. Run `sandbox_list` for each account to find leftovers.

## Charges

> [!WARNING]
> Closing OpenCode does not stop a sandbox. It keeps running, and can be charged, until destroyed or until its lifetime ends.

- **Direct:** your provider bills your account while the sandbox exists. No Gitterm account or credits are used.
- **Managed:** your Gitterm plan is charged for active time. A sandbox pauses after your plan's idle timeout, and paused time is not billed as active. Plan limits apply, including the workspace limit, which counts sandboxes. See [Plans and billing](/docs/account/plans-and-billing).

`sandbox_list` shows who is charged for the account and for each sandbox.

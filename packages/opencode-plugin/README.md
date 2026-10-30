# @gitterm/opencode-plugin

Continue your local [OpenCode](https://opencode.ai) session in a
[GitTerm](https://gitterm.dev) cloud workspace—with your conversation, unpublished
commits, and optionally your uncommitted changes. Connect from another device and
keep working without changing your local checkout.

## Install

### Using the OpenCode CLI

```sh
opencode plugin add @gitterm/opencode-plugin
```

This installs the plugin and adds it to your global OpenCode configuration.

### Using opencode.json

Alternatively, add the package to `plugins` in your project's `opencode.json`, or
`~/.config/opencode/opencode.json` to enable it globally:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@gitterm/opencode-plugin"]
}
```

Keep any existing settings and plugin entries. OpenCode installs the package
automatically. Restart OpenCode if the commands do not appear.

## Sign in to GitTerm

Install the GitTerm CLI and sign in:

```sh
npm install -g @gitterm/cli
gitterm login
```

Follow the browser sign-in instructions. The plugin uses the same saved login.
You can instead set `GITTERM_API_TOKEN` before starting OpenCode.

In GitTerm, configure your model credentials and repository access before
creating a cloud workspace. Your deployment must have a compute provider enabled.
Keep OpenCode up to date on both your computer and your cloud workspace.

For a private repository, attach your GitHub connection using the `connections`
option in the [configuration example](#configuration) below.

## Continue a session in the cloud

Open OpenCode in a Git repository with an `origin` remote. Stop the current
agent's execution and finish or cancel pending input, then run:

```text
/cloud
```

1. **Choose whether to include uncommitted changes.** If other active sessions
   share the checkout, the prompt warns that their changes may be included too.
2. **Review and approve the transfer.** Check the repository, commit, changed
   paths, and snapshot size before approving upload and billable cloud compute.
3. **Connect to the cloud session.** Open the connection link in your browser, or
   paste the one-time link into the OpenCode desktop app's **Connect server**
   dialog. Select the imported session to continue.

GitTerm restores your checkout on an isolated `gitterm/…` branch and imports the
conversation. It does not automatically start an agent run. Your local files and
sessions stay unchanged.

### Reconnect later

```text
/cloud
```

After a successful transfer, the same command opens your **existing cloud
workspace**, with its current cloud files and conversation. If it is paused,
the plugin resumes it when supported and offers a fresh connection link.
It does not create another workspace, upload newer local edits, or merge cloud
changes back to your computer.

Pairing links work once and expire after five minutes; run `/cloud` again when you
need another. If pairing is unavailable, use the workspace connection details in
your GitTerm dashboard.

**Pause or terminate the workspace in GitTerm when you are finished.** Cloud
compute can incur charges independently of your local session. If a transfer
fails after provisioning, inspect the workspace or attempt ID shown in the error
before retrying; the plugin does not automatically delete cloud workspaces.

## What gets transferred?

| Included                                                                     | Not included                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| The selected conversation's history                                          | Other conversations or child sessions                |
| Git history reachable from the current commit, including unpublished commits | Running processes and terminals                      |
| Staged and unstaged changes, when you opt in                                 | Ignored untracked files, such as an ignored `.env`   |
| Binary edits, deletions, and non-ignored untracked regular files             | Global OpenCode settings and local credential stores |

Staged and unstaged changes remain separate. No local commit or push is required.
Repository-owned configuration travels with the code. Use the model credentials
configured in GitTerm; choose an available cloud model or agent if your local
selection is unavailable.

**Changes belong to the checkout, not a conversation.** If several sessions use
the same checkout, including uncommitted changes copies the captured checkout
state—not just edits made by the selected session. Other servers, editors, and
background writers cannot all be detected, so pause writers before transferring.
Later local edits do not sync automatically, and cloud changes are not
automatically merged back.

## Configuration

To choose a provider or attach saved GitTerm connections, use an options object:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@gitterm/opencode-plugin",
      "options": {
        "provider": { "type": "e2b" },
        "connections": ["github"]
      }
    }
  ]
}
```

Choose a provider enabled on your deployment. `connections` accepts saved
connection IDs, names, or integration keys; `"github"` selects a connection that
covers the repository. Omit it when no integration is needed.

| Option        | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `provider`    | Provider selection, such as `{ "type": "e2b" }`; otherwise uses GitTerm defaults |
| `connections` | Saved GitTerm connections to attach to the cloud workspace                       |
| `name`        | Cloud workspace name; defaults to the conversation title                         |
| `persistent`  | Request persistent storage where the provider supports it                        |
| `serverUrl`   | Override the GitTerm API URL                                                     |
| `token`       | Override authentication; prefer a saved login or `GITTERM_API_TOKEN`             |

### Self-hosted GitTerm

```sh
gitterm login --server https://gitterm.example.com
```

The plugin uses the saved server URL. Environment variables
`GITTERM_SERVER_URL` and `GITTERM_API_TOKEN` can override the saved login.

### Standalone or custom OpenCode servers

The plugin normally discovers your local OpenCode service automatically. If you
use a standalone or custom server, set `localServerUrl` to its loopback URL and
`localServerPassword` when authentication is required. You can instead set
`GITTERM_OPENCODE_LOCAL_SERVER_URL` and
`GITTERM_OPENCODE_LOCAL_SERVER_PASSWORD` before starting OpenCode.

## Run commands in a remote sandbox

The plugin also gives the local agent sandbox tools: `sandbox_create`, `sandbox_list`,
`sandbox_sync`, `sandbox_exec`, `sandbox_job`, `sandbox_cancel`, `sandbox_preview`,
`sandbox_artifact`, `sandbox_apply`, `sandbox_resume`, `sandbox_destroy`, and `sandbox_account`. The
conversation and your files stay local. Commands run in a separate sandbox with no
coding agent or model credentials. Local shell execution and `/cloud` are unchanged.

Configure an account under `sandbox` in the plugin options. Bring your own provider
credential (E2B, Daytona, Vercel, Boat, exe.dev, or Railway) with
OpenCode's substitution, or use your Gitterm plan with `"mode": "managed"`:

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
          "limits": { "maxSandboxes": 2, "maxLifetimeMinutes": 60 },
        },
      },
    },
  ],
}
```

A direct account needs no Gitterm login, and the provider bills your own account. Creating,
uploading, running, passing secrets, public previews, and writing artifacts into the
checkout ask for permission. You can approve routine work once with `permissions` rules,
for example `{ "action": "gitterm.sandbox.exec", "resource": "direct:e2b:*", "effect": "allow" }`.
When you load the plugin from a local path, point `package` at the package directory,
not a file.

See [Agent sandboxes](../../docs/agent-sandboxes.md) for credentials, charges, cleanup,
and limits.

## Limits and privacy

- Checkout snapshots and conversation history are each limited to **25 MiB**.
  Git history counts toward the checkout limit, even if few files are changed.
- Repositories need a credential-free HTTPS origin; GitHub SSH origins are also
  accepted. GitTerm must be able to clone the repository.
- Merge conflicts, submodules, intent-to-add files, and untracked symlinks or
  special files are not supported. Resolve or remove them before transferring.
- Common secret-file names and private-key markers in changed files are blocked,
  but this is **not comprehensive secret scanning**. Conversation history,
  tracked files, and Git history may contain secrets. Review the upload before
  approving it. Ignoring a tracked file does not remove it from Git history.
- This is a one-way continuation in a separate cloud workspace, not live file
  synchronization or a native remote-worktree entry in OpenCode.

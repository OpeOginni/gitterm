# @gitterm/opencode-cloud

Move your local [OpenCode](https://opencode.ai) session to a [GitTerm](https://gitterm.dev)
cloud workspace with one command, `/cloud`. Your conversation, commits, and (if you choose)
uncommitted changes go with it. Your local files stay as they are. `/cloud-return` brings the
session and the cloud's work back.

Formerly `@gitterm/opencode-plugin`. Want the agent to run commands remotely while the
session stays local? Use [`@gitterm/opencode-sandbox`](../opencode-sandbox/README.md).

## 1. Install

Requires OpenCode 2.2.6 or newer.

```sh
opencode plugin add @gitterm/opencode-cloud
```

## 2. Sign in to GitTerm

```sh
npm install -g @gitterm/cli
gitterm login
```

In GitTerm, add your model credentials and repository access first.

## 3. Use it

In a Git repository, stop the agent and finish or stop its background jobs, then type `/cloud` in
OpenCode.

1. Choose whether to include uncommitted changes.
2. Review the upload and approve starting the workspace. It is billed while it runs.
3. A dialog shows each step. Esc cancels and deletes the workspace that was just created.
4. Open the link to continue in the cloud.

Run `/cloud` again later to reconnect to the same workspace. **Pause or delete the
workspace in GitTerm when you are done**, or bring the session back.

### Come back

While the session is in the cloud, the terminal shows a "Cloud" block in the sidebar and a
line above the prompt with what the cloud side is doing: working, needs your input, idle,
paused, or deleted. You get a notification when the cloud agent finishes or needs you.
Checking this does not keep the workspace awake: an idle workspace still pauses as usual.

If you send a message in that session locally, OpenCode asks first, because the cloud session
would not see it.

`/cloud-return` appears in the command list only while a session of this checkout is in the
cloud.

When the cloud agent has stopped, type `/cloud-return` in the local session.

The cloud's new commits, its uncommitted changes and its conversation replace the local ones.

- If your checkout and conversation are as you handed them off, nothing is asked.
- If you changed them since, `/cloud-return` asks first. Your uncommitted changes are kept in a Git
  stash, your commits on a `gitterm/before-return-…` branch, and your messages in a copy of
  the session.
- At the end the workspace is deleted, since its work is now local. Files Git ignores in
  the cloud (such as `.env`) do not come back.

### Snapshots: a faster start next time

On E2B, Daytona, Vercel, Boat and GitTerm's own machines, with a plan that includes
snapshots, `/cloud-return` first asks whether to keep a snapshot of the workspace for the
project. If you do, the next `/cloud` for that repository starts from it: the agent is
already installed and the files Git ignores (installed dependencies, build output) are in
place, so there is nothing to set up again.

- There is one snapshot per repository. Keeping one again replaces the older one, and once
  you have kept one, "yes" is preselected.
- Before it is saved, the workspace's credentials and its conversations are removed from it.
- If a snapshot cannot be started any more, `/cloud` starts a fresh workspace instead.
- Snapshots are listed in the GitTerm dashboard, where you can delete them.

## Settings

All optional:

```jsonc
{
  "plugins": [
    {
      "package": "@gitterm/opencode-cloud",
      "options": {
        "provider": { "type": "e2b" },
        "connections": ["github"],
      },
    },
  ],
}
```

| Option        | What it does                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`    | Cloud provider to use, for example `{ "type": "e2b" }`                                                                                                                                                           |
| `connections` | Saved GitTerm connections, for example `"github"` for private repositories. A checkout without an origin skips GitHub connections; naming one by name or id needs the `integrations:read` scope to be recognised |
| `name`        | Workspace name; defaults to the conversation title                                                                                                                                                               |
| `persistent`  | Keep storage between restarts, where the provider allows                                                                                                                                                         |
| `envFiles`    | Env files whose variables the workspace gets, for example `[".env", ".gitterm.env"]`. Paths are relative to the checkout root, and a later file wins. The upload confirmation lists the variable names           |

Self-hosting GitTerm? Sign in with `gitterm login --server https://gitterm.example.com`.
`/cloud` talks to the OpenCode server that holds your session. It finds OpenCode's background
service by itself. `opencode --standalone` uses a private server on a random port that `/cloud`
can't reach; instead run `opencode serve --port 4096`, open it with
`opencode --server http://127.0.0.1:4096`, and set `localServerUrl` to that address (and
`localServerPassword` to its password).

## Good to know

- Only the current conversation moves. Running processes, ignored files (such as `.env`),
  and your global OpenCode settings do not. To give the workspace your env variables, list
  the files in `envFiles`. Only send the ones the workspace should have. They are set
  when the workspace is created, so after editing a file, start a new workspace.
- Nothing syncs while the session is in the cloud: later local edits are not sent. `/cloud-return`
  replaces the local checkout with the cloud's; it does not merge the two.
- `/cloud-return` brings back at most 25 MiB of new commits and uncommitted changes. For more, push
  the branch from the cloud and pull it.
- GitTerm must be able to clone your repository's `origin`.
- The cloud checkout is on a branch with the same name as your local one.
- If a handoff fails partway, run `/cloud` again and choose to retry: it continues in the
  workspace that attempt created instead of starting a second one. If you already worked in
  that cloud checkout or session, the retry stops and leaves your cloud work as it is.
- The checkout and the conversation are each limited to 25 MiB. Submodules and merge
  conflicts are not supported.
- Common secret files are blocked, but this is not full secret scanning. Check the
  upload before you approve it.

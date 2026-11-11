# @gitterm/opencode-cloud

Move your local [OpenCode](https://opencode.ai) session to a [GitTerm](https://gitterm.dev)
cloud workspace with one command, `/cloud`. Your conversation, commits, and (if you choose)
uncommitted changes go with it. Your local files stay as they are.

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

In a Git repository, stop the agent and finish or stop its background jobs, then type:

```text
/cloud
```

1. Choose whether to include uncommitted changes.
2. Review what will be uploaded and approve it. The workspace is billed while it runs.
3. Open the link to continue in the cloud.

Run `/cloud` again later to reconnect to the same workspace. **Pause or delete the
workspace in GitTerm when you are done.**

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

| Option        | What it does                                                               |
| ------------- | -------------------------------------------------------------------------- |
| `provider`    | Cloud provider to use, for example `{ "type": "e2b" }`                     |
| `connections` | Saved GitTerm connections, for example `"github"` for private repositories |
| `name`        | Workspace name; defaults to the conversation title                         |
| `persistent`  | Keep storage between restarts, where the provider allows                   |

Self-hosting GitTerm? Sign in with `gitterm login --server https://gitterm.example.com`.
`/cloud` talks to the OpenCode server that holds your session. It finds OpenCode's background
service by itself. `opencode --standalone` uses a private server on a random port that `/cloud`
can't reach; instead run `opencode serve --port 4096`, open it with
`opencode --server http://127.0.0.1:4096`, and set `localServerUrl` to that address (and
`localServerPassword` to its password).

## Good to know

- Only the current conversation moves. Running processes, ignored files (such as `.env`),
  and your global OpenCode settings do not.
- It is one way: later local edits are not sent, and cloud changes are not merged back.
  Use Git to move work between them.
- GitTerm must be able to clone your repository's `origin`.
- The cloud checkout is on a branch with the same name as your local one.
- If a handoff fails partway, run `/cloud` again and choose to retry: it continues in the
  workspace that attempt created instead of starting a second one. If you already worked in
  that cloud checkout or session, the retry stops and leaves your cloud work as it is.
- The checkout and the conversation are each limited to 25 MiB. Submodules and merge
  conflicts are not supported.
- Common secret files are blocked, but this is not full secret scanning. Check the
  upload before you approve it.

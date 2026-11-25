# @gitterm/opencode

[GitTerm](https://gitterm.dev) for [OpenCode](https://opencode.ai):

- **Sandboxes.** Your agent runs builds, tests and preview servers in remote sandboxes, with
  your own provider key or a GitTerm plan. The conversation and your files stay here.
- **`/cloud`.** Move the whole session (conversation, commits and, if you choose, uncommitted
  changes) to a GitTerm cloud workspace, and bring it back with `/cloud-return`.

It replaces `@gitterm/opencode-sandbox` and `@gitterm/opencode-cloud`; see
[Moving from the old plugins](#moving-from-the-old-plugins).

## Install

Requires OpenCode 2.3.0 or newer.

```sh
npx @gitterm/cli setup
```

That installs this plugin, sets up GitTerm for your other agents (Pi, Codex, Claude Code), and
signs you in. To install only the plugin:

```sh
opencode plugin add @gitterm/opencode
```

## What turns on

Each part turns on by itself when it can work:

| You have                                            | Sandbox tools                    | `/cloud` and `/cloud-return`     |
| --------------------------------------------------- | -------------------------------- | -------------------------------- |
| A GitTerm login (gitterm.dev or self-hosted)        | Yes, billed to your GitTerm plan | Yes                              |
| Your own provider key under `sandbox`, and no login | Yes                              | No: moving needs a GitTerm login |
| Neither                                             | No                               | Yes: `/cloud` signs you in       |

Restart OpenCode after signing in, so the sandbox tools appear.

## Sandboxes

### Choose the account

Signed in to GitTerm, there is nothing to set: sandboxes are billed to your plan. To pick a
machine size, or a provider on a self-hosted GitTerm:

```jsonc
{
  "plugins": [
    {
      "package": "@gitterm/opencode",
      "options": { "sandbox": { "size": "medium" } },
    },
  ],
}
```

To use your own provider account instead, put its key under `sandbox`:

```jsonc
"options": { "sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" } }
```

Never paste a key directly. OpenCode fills it in for you: `"{env:E2B_API_KEY}"` reads an
environment variable and `"{file:~/.secrets/e2b}"` reads a file.

`"sandbox": false` or `"cloud": false` turns that part off. In a project's own `opencode.json`,
the plugin's options apply to that project only and replace the global ones there;
`"-gitterm"` in its `plugins` leaves the plugin out of that project.

#### Other providers

Each goes under `sandbox`:

```jsonc
{ "provider": "daytona", "apiKey": "{env:DAYTONA_API_KEY}" }
{ "provider": "boat", "apiKey": "{env:BOAT_API_KEY}" }
{ "provider": "vercel", "apiKey": "{env:VERCEL_TOKEN}", "teamId": "team_…", "projectId": "prj_…" }
{ "provider": "railway", "apiKey": "{env:RAILWAY_TOKEN}", "projectId": "…", "environmentId": "…", "allowUnboundedLifetime": true }
{ "provider": "exedev", "apiKey": "{env:EXEDEV_API_KEY}", "allowUnboundedLifetime": true }
```

Railway and exe.dev never delete a forgotten sandbox themselves, so they need
`allowUnboundedLifetime: true`. Destroy sandboxes you no longer need.

E2B, Daytona, and exe.dev accounts can leave out `apiKey` to use the provider's CLI login:
the key from `e2b auth login` or `daytona login --api-key`, or a token signed with the SSH key
that `ssh exe.dev` uses.

```jsonc
{ "provider": "exedev", "allowUnboundedLifetime": true }
```

#### Several accounts

Put each under `accounts` and pick one with `account`:

```jsonc
"sandbox": {
  "account": "e2b",
  "accounts": {
    "e2b": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
    "gitterm": { "size": "medium" },
  },
}
```

### Use them

Ask the agent, for example: _"Run the test suite in a sandbox."_ It will create a
sandbox, upload your checkout (uncommitted changes included, secret-like files skipped),
and run the command there. OpenCode asks before anything is created, uploaded, run, or
written back to your files.

Long builds and tests run in the background: you can keep talking to the agent, and it
gets a message when each job finishes.

| Tool               | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `sandbox_create`   | Create a sandbox                                                     |
| `sandbox_list`     | Show your account, who is charged, and your sandboxes                |
| `sandbox_sync`     | Upload your checkout                                                 |
| `sandbox_exec`     | Run a command; with `background`, get a message when it finishes     |
| `sandbox_job`      | Check a command's output, or cancel it                               |
| `sandbox_preview`  | Open a port, for example a dev server                                |
| `sandbox_artifact` | Download a file the command produced                                 |
| `sandbox_apply`    | Copy that file into your checkout, if your copy did not change since |
| `sandbox_snapshot` | Save or delete the project's setup snapshot (with `snapshots: true`) |
| `sandbox_pause`    | Pause a sandbox, keeping its files; using it again resumes it        |
| `sandbox_destroy`  | Delete a sandbox                                                     |

The right sidebar lists this checkout's sandboxes, with what each is running.

### Optional settings

```jsonc
"sandbox": {
  "provider": "e2b",
  "apiKey": "{env:E2B_API_KEY}",
  "limits": {
    "maxSandboxes": 2,
    "maxLifetimeMinutes": 60,
    "defaultLifetimeMinutes": 30,
    "maxJobMinutes": 30
  },
  "exclude": ["fixtures/large/**"],
  "maxSourceMiB": 100,
  "publicPreviews": true
}
```

`maxSourceMiB` sets the checkout size limit before compression, in whole MiB from 1 to 1024 (default 100).

#### Machine size

You choose the size per account; the agent can't change it. If a build runs out of memory,
pick a bigger size:

```jsonc
{ "size": "medium" }
{ "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "template": "my-8gb-template" }
{ "provider": "daytona", "apiKey": "{env:DAYTONA_API_KEY}", "resources": { "cpu": 4, "memory": 8 } }
{ "provider": "vercel", "apiKey": "{env:VERCEL_TOKEN}", "teamId": "team_…", "projectId": "prj_…", "vcpus": 4 }
{ "provider": "boat", "apiKey": "{env:BOAT_API_KEY}", "size": "large" }
{ "provider": "exedev", "apiKey": "{env:EXEDEV_API_KEY}", "cpu": 4, "memory": "8GB", "allowUnboundedLifetime": true }
```

E2B's default `base` template has 512 MB of memory, too little for most builds. E2B sets
memory when a template is built, so build your own once
(`e2b template build --cpu-count 4 --memory-mb 8192`) and put its name in `template`.

`publicPreviews: true` makes every preview URL open to anyone who has it, with no
prompt. With your own key it works on E2B and Daytona. Boat, exe.dev, and Railway are
always private, so it is ignored there. Vercel is always public, so a Vercel sandbox can
only show previews when created with public previews (this setting, or your approval when
the agent asks). With a GitTerm plan, GitTerm serves the preview, so it also works on Boat
and exe.dev, and private previews open in your browser when you are signed in to GitTerm.

With a GitTerm plan, the agent can also make one port public on a running sandbox, or private
again, and OpenCode asks before it makes one public. With your own key, this is fixed when the
sandbox is created.

To stop being asked every time, allow actions in your OpenCode `permissions`:

```jsonc
"permissions": [
  { "action": "gitterm.sandbox.exec", "resource": "e2b:*", "effect": "allow" }
]
```

`e2b` is the account name: its name under `accounts`, or for a single account its
`provider` (`gitterm` when it has none).

#### Environment variables

List env files and every command gets their variables, including dev servers that
`sandbox_preview` starts:

```jsonc
"sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "envFiles": [".env.development"] }
```

Paths are relative to the project directory, and a later file wins over an earlier one. The
files are read on each command, so edits apply at once.

Values are passed outside the conversation. In command output, each line of an env value
with at least four characters is replaced with `[redacted]`. Shorter values or lines, such as `DEBUG=1`, can appear
in output because replacing them would garble unrelated text.

The agent can also pass a variable from your local environment by naming it in `secretEnv`.
OpenCode asks first, and it wins over a file's variable of the same name.
Commands can save values to files that snapshots retain.

#### Setup snapshots

For a project with a slow setup, let the agent save a sandbox once dependencies are
installed, so the project's next sandboxes start ready:

```jsonc
"sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "snapshots": true }
```

Works with E2B, Daytona, Vercel, or Boat, with your own key or a GitTerm plan (Pro keeps 20 snapshots, Growth 100). The agent gets a `sandbox_snapshot`
tool and OpenCode asks before each save or delete. A project can have several snapshots
(say `deps` and `deps + postgres`), or the agent can save a general one for any project.
New sandboxes start from the project's newest one unless the agent picks another, and the
agent is told when a lockfile changed since a snapshot so it can replace it (the old one is
deleted). Snapshots are kept in your provider account until deleted. To let it save without asking, allow
`gitterm.sandbox.snapshot` in `permissions` as above.

To start every sandbox from a snapshot you made yourself, set it on the account instead;
the agent then doesn't manage snapshots for that account:

```jsonc
{ "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "snapshot": "my-snapshot:latest" }
```

## Move a session to the cloud

### Use it

In a Git repository, type `/cloud` in OpenCode. The workspace is billed while it runs.

1. The first time, `/cloud` asks you to sign in to GitTerm. Open the link (or scan the QR
   code), sign in or create an account, and approve the code. The dialog closes by itself.
   The login is shared with the [GitTerm CLI](https://www.npmjs.com/package/@gitterm/cli),
   so if you already ran `gitterm login`, nothing is asked.
2. Your local model keys don't move. The cloud agent can use free models, or the models you
   add in GitTerm (recommended). With none added, `/cloud` suggests it first.
3. For a private repository, connect GitHub in GitTerm. Without it, `/cloud` uploads the
   history instead (up to 25 MiB), and the cloud checkout can't push or pull.
4. If you have uncommitted changes, choose whether to bring them.
5. A dialog shows each step. Esc cancels and deletes the workspace that was just created.
6. Scan the QR code with your phone, or open the link on your computer, to continue in the
   cloud. Pairing links sign you in once and expire after five minutes; `/cloud` makes a new one.

The agent doesn't have to be idle. If it is working, `/cloud` stops it here and it picks up
where it left off in the cloud. Text after the command is sent to the cloud agent:
`/cloud finish the migration and run the tests`.

Run `/cloud` again later to reconnect to the same workspace, with or without a message.
**Pause or delete the workspace in GitTerm when you are done**, or bring the session back.

#### Come back

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
- It first asks whether to delete the workspace or pause it, since its work is now local.
  Files Git ignores in the cloud (such as `.env`) do not come back. Nothing changes until
  you answer, and a progress dialog shows each step after that.

#### Snapshots: a faster start next time

On E2B, Daytona, Vercel, Boat and GitTerm's own machines, with a plan that includes
snapshots, `/cloud-return` instead first asks whether to keep a snapshot of the workspace
for the project. Either way the workspace is then deleted. If you do, the next `/cloud` for that repository starts from it: the agent is
already installed and the files Git ignores (installed dependencies, build output) are in
place, so there is nothing to set up again.

- There is one snapshot per repository. Keeping one again replaces the older one.
- Before it is saved, the workspace's credentials and its conversations are removed from it.
- If a snapshot cannot be started any more, `/cloud` starts a fresh workspace instead.
- Snapshots are listed in the GitTerm dashboard, where you can delete them.

### Settings

All optional, next to `sandbox` in the plugin's options:

| Option        | What it does                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`    | Cloud provider to use, for example `{ "type": "e2b" }`                                                                                                                                                           |
| `connections` | Saved GitTerm connections, for example `"github"` for private repositories. A checkout without an origin skips GitHub connections; naming one by name or id needs the `integrations:read` scope to be recognised |
| `name`        | Workspace name; defaults to the conversation title                                                                                                                                                               |
| `persistent`  | Keep storage between restarts, where the provider allows                                                                                                                                                         |
| `envFiles`    | Env files whose variables the workspace gets, for example `[".env", ".gitterm.env"]`. Paths are relative to the checkout root, and a later file wins.                                                            |

Self-hosting GitTerm? Set `serverUrl` to your GitTerm API URL, or sign in with
`gitterm login --server https://gitterm.example.com`.
`/cloud` talks to the OpenCode server that holds your session. It finds OpenCode's background
service by itself. `opencode --standalone` uses a private server on a random port that `/cloud`
can't reach; instead run `opencode serve --port 4096`, open it with
`opencode --server http://127.0.0.1:4096`, and set `localServerUrl` to that address (and
`localServerPassword` to its password).

### Good to know

- Only the current conversation moves. Running processes, ignored files (such as `.env`),
  and your global OpenCode settings do not. To give the workspace your env variables, list
  the files in `envFiles`. Only send the ones the workspace should have. They are set
  when the workspace is created, so after editing a file, start a new workspace.
- Nothing syncs while the session is in the cloud: later local edits are not sent. `/cloud-return`
  replaces the local checkout with the cloud's; it does not merge the two.
- `/cloud-return` brings back at most 25 MiB of new commits and uncommitted changes. For more, push
  the branch from the cloud and pull it.
- The cloud checkout is on a branch with the same name as your local one.
- If moving fails or you cancel it, the workspace it created is deleted and an agent it
  stopped carries on here. Run `/cloud` to try again.
- Background commands (running processes) can't move: let them finish first. A message waiting
  to be sent has to run or be removed first too.
- The checkout and the conversation are each limited to 25 MiB. Submodules and merge
  conflicts are not supported.
- Common secret files are blocked, but this is not full secret scanning. Check the
  upload before you approve it.

## Moving from the old plugins

1. Install `@gitterm/opencode`. `gitterm setup` does it, and says when an old plugin is still in
   your config.
2. Keep the options of `@gitterm/opencode-cloud` as they are. Put the options of
   `@gitterm/opencode-sandbox` under `sandbox`.
3. Remove the old plugins, so `/cloud` isn't added twice:

   ```sh
   opencode plugin remove @gitterm/opencode-cloud
   opencode plugin remove @gitterm/opencode-sandbox
   ```

More detail: [OpenCode plugin reference](https://gitterm.dev/docs/reference/opencode-plugin),
[Agent sandboxes](../../docs/agent-sandboxes.md).

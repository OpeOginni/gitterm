# @gitterm/opencode-sandbox

Let your [OpenCode](https://opencode.ai) agent run builds, tests, and preview servers in a
remote sandbox. Your conversation and files stay on your machine.

Want to move the whole session to the cloud instead? Use
[`@gitterm/opencode-cloud`](../opencode-cloud/README.md).

## 1. Install

```sh
opencode plugin add @gitterm/opencode-sandbox
```

## 2. Add your provider key

In `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```jsonc
{
  "plugins": [
    {
      "package": "@gitterm/opencode-sandbox",
      "options": {
        "account": "e2b",
        "accounts": {
          "e2b": { "mode": "direct", "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
        },
      },
    },
  ],
}
```

Never paste a key directly. OpenCode fills it in for you:

- `"{env:E2B_API_KEY}"` reads an environment variable.
- `"{file:~/.secrets/e2b}"` reads a file.

Restart OpenCode after changing the settings.

### Other providers

Add the account and set `"account"` to its name:

```jsonc
"daytona": { "mode": "direct", "provider": "daytona", "apiKey": "{env:DAYTONA_API_KEY}" },
"boat":    { "mode": "direct", "provider": "boat", "apiKey": "{env:BOAT_API_KEY}" },
"vercel":  { "mode": "direct", "provider": "vercel", "apiKey": "{env:VERCEL_TOKEN}", "teamId": "team_…", "projectId": "prj_…" },
"railway": { "mode": "direct", "provider": "railway", "apiKey": "{env:RAILWAY_TOKEN}", "projectId": "…", "environmentId": "…", "allowUnboundedLifetime": true },
"exedev":  { "mode": "direct", "provider": "exedev", "apiKey": "{env:EXEDEV_API_KEY}", "allowUnboundedLifetime": true },
```

Railway and exe.dev never delete a forgotten sandbox themselves, so they need
`allowUnboundedLifetime: true`. Destroy sandboxes you no longer need.

### Or use your GitTerm plan

No provider account needed. Sign in once, then use a managed account:

```sh
npm install -g @gitterm/cli
gitterm login
```

```jsonc
"gitterm": { "mode": "managed", "size": "medium" },
```

## 3. Use it

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
| `sandbox_destroy`  | Delete a sandbox                                                     |

The right sidebar lists this checkout's sandboxes, with what each is running.

## Optional settings

```jsonc
"options": {
  "account": "e2b",
  "accounts": { … },
  "limits": {
    "maxSandboxes": 2,
    "maxLifetimeMinutes": 60,
    "defaultLifetimeMinutes": 30,
    "maxJobMinutes": 30
  },
  "exclude": ["fixtures/large/**"],
  "publicPreviews": true
}
```

### Machine size

You choose the size per account; the agent can't change it. If a build runs out of memory,
pick a bigger size:

```jsonc
"gitterm": { "mode": "managed", "size": "large" },
"e2b":     { "mode": "direct", "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "template": "my-8gb-template" },
"daytona": { "mode": "direct", "provider": "daytona", "apiKey": "{env:DAYTONA_API_KEY}", "resources": { "cpu": 4, "memory": 8 } },
"vercel":  { "mode": "direct", "provider": "vercel", "apiKey": "{env:VERCEL_TOKEN}", "teamId": "team_…", "projectId": "prj_…", "vcpus": 4 },
"boat":    { "mode": "direct", "provider": "boat", "apiKey": "{env:BOAT_API_KEY}", "size": "large" },
"exedev":  { "mode": "direct", "provider": "exedev", "apiKey": "{env:EXEDEV_API_KEY}", "cpu": 4, "memory": "8GB", "allowUnboundedLifetime": true },
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

To stop being asked every time, allow actions in your OpenCode `permissions`:

```jsonc
"permissions": [
  { "action": "gitterm.sandbox.exec", "resource": "direct:e2b:*", "effect": "allow" }
]
```

More detail on costs, cleanup, and permissions:
[Agent sandboxes](../../docs/agent-sandboxes.md).

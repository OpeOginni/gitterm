---
title: Sandbox setup
nav: Setup
description: Install the sandbox plugin, add a sandbox account, and choose what needs your approval.
---

This page walks you through giving your local OpenCode agent remote sandboxes: install `@gitterm/opencode-sandbox`, add an account, and decide what needs your approval. Read [Sandboxes overview](/docs/sandboxes/overview) first if you are not sure what a sandbox is. Every field is listed in the [Sandbox plugin reference](/docs/reference/sandbox-plugin#options).

## Before you start

- OpenCode installed, and a project that is a Git checkout. `sandbox_sync` uses Git to decide which files to upload.
- One of:
  - a key for E2B, Daytona, Vercel, Boat, exe.dev, or Railway, for a **direct** account, or
  - a Gitterm account, for a **managed** account.

Not sure which? See [Managed and direct accounts](/docs/concepts#managed-and-direct-accounts).

## Steps

1. Install the plugin:

   ```sh
   opencode plugin add @gitterm/opencode-sandbox
   ```

   This adds `@gitterm/opencode-sandbox` to your global OpenCode config.

2. Add an account. In your OpenCode config, replace the plugin entry with an object that has `options`:

   ```jsonc
   {
     "plugins": [
       {
         "package": "@gitterm/opencode-sandbox",
         "options": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
       },
     ],
   }
   ```

   With an `apiKey` it is [a direct account](#direct-accounts); without one, [a managed account](#managed-accounts). For [several accounts](#several-accounts), name them under `accounts`.

3. Optional: set [limits and exclusions](#limits-and-exclusions), turn on [public previews](/docs/sandboxes/jobs-and-previews#public-previews), and [pre-approve routine actions](#approvals).

4. Restart OpenCode and ask the agent:

   ```text
   Which sandbox account are you using?
   ```

   You should see the selected account and provider, where the key comes from, whether it is present, who is charged, the limits, and the provider's limitations. The key itself is never shown. If the key is missing, fix the variable and restart OpenCode.

## Direct accounts

A direct account uses your own provider key: it has `provider` and `apiKey`. The provider bills your account. No Gitterm login is needed.

Never type the key into the config. Use OpenCode's substitution, which fills in the value when OpenCode loads the config:

```jsonc
// From an environment variable (set it before starting OpenCode)
"apiKey": "{env:E2B_API_KEY}"

// From a file
"apiKey": "{file:~/.secrets/e2b}"
```

The key stays in the OpenCode process and is sent only to that provider's API. If it is empty or the provider rejects it, the tools fail with an error. They never fall back to another account.

Some providers need more than `apiKey`:

| Provider | `provider` | Also required                                                  |
| -------- | ---------- | -------------------------------------------------------------- |
| E2B      | `e2b`      | Nothing                                                        |
| Daytona  | `daytona`  | Nothing                                                        |
| Vercel   | `vercel`   | `teamId`, `projectId`                                          |
| Boat     | `boat`     | Nothing                                                        |
| exe.dev  | `exedev`   | `"allowUnboundedLifetime": true`                               |
| Railway  | `railway`  | `projectId`, `environmentId`, `"allowUnboundedLifetime": true` |

exe.dev and Railway never delete a sandbox on their own. `allowUnboundedLifetime` is how you accept that a sandbox left behind by a crash keeps running and billing until you destroy it. Without it, creation is refused. Optional fields, such as an E2B template or a Vercel runtime, are in [Account fields](/docs/reference/sandbox-plugin#account-fields).

## Managed accounts

A managed account has no `apiKey` and uses your Gitterm plan. The Gitterm deployment holds the provider account.

1. Sign in with the Gitterm CLI:

   ```sh
   npm install -g @gitterm/cli
   gitterm login
   ```

   You should see `Logged in as <your email>`. Instead of logging in, you can set `GITTERM_API_TOKEN` before starting OpenCode.

2. Add the account. On gitterm.dev, pick a size:

   ```jsonc
   "options": { "size": "medium" }
   ```

   On a self-hosted deployment, add its address. Without `provider` it uses the deployment's default: the only provider it offers, or the one its admin prefers. Set `provider` to pick another:

   ```jsonc
   "options": { "serverUrl": "https://gitterm.example.com", "provider": "daytona" }
   ```

The provider must be enabled on the deployment and allowed by your plan. If it isn't, the tools say which providers the deployment offers, and that adding `apiKey` uses your own account instead. Creation also checks your run allowance and your workspace limit, which counts sandboxes too.

> [!NOTE]
> On E2B, Daytona, Boat, and exe.dev, managed previews are served through Gitterm. They can be public, or private and open in your browser when you are signed in to Gitterm. See [Previews through Gitterm](/docs/sandboxes/jobs-and-previews#previews-through-gitterm).

## Several accounts

Name each account under `accounts`, and pick the one the tools use with `account`:

```jsonc
"options": {
  "account": "e2b",
  "accounts": {
    "e2b": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
    "gitterm": { "size": "medium" }
  }
}
```

The account name is what [approval rules](#approvals) match. A single account in `options` is named after its `provider`, or `gitterm` when it has none.

## Limits and exclusions

`limits` caps what the agent can start. `exclude` lists extra glob patterns that `sandbox_sync` never uploads. Secret-like files are always left out; see [Security](/docs/sandboxes/security#what-a-sandbox-never-receives).

```jsonc
"options": {
  "provider": "e2b",
  "apiKey": "{env:E2B_API_KEY}",
  "limits": { "maxSandboxes": 2, "maxLifetimeMinutes": 60, "defaultLifetimeMinutes": 30, "maxJobMinutes": 30 },
  "exclude": ["fixtures/large/**"]
}
```

The values above are the defaults. What each limit does is in [Limits](/docs/reference/sandbox-plugin#limits).

## Setup snapshots

For a project with a slow setup, let the agent save a sandbox once dependencies are installed. The project's next sandboxes start from it, ready to run.

```jsonc
"options": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "snapshots": true }
```

- Works on E2B, Daytona, Vercel and Boat, with your own key or a Gitterm plan, and on Gitterm's own machines. On a plan, snapshots need Pro or Growth; see [Plans](/docs/account/plans-and-billing#plans).
- The agent gets a `sandbox_snapshot` tool. OpenCode asks before each save or delete; allow `gitterm.sandbox.snapshot` under [Approvals](#approvals) to skip the prompt.
- A project can have several snapshots, such as one with dependencies and one with dependencies and a database. New sandboxes start from the project's newest one unless the agent picks another.
- When a lockfile changed since a snapshot, the agent is told. It can then save a replacement, which deletes the old one. Until it does, the old one is still used.
- On Vercel, saving a snapshot ends the sandbox it was saved from.
- Snapshots stay in the provider account until deleted. On a Gitterm plan they are listed under **Agent sandboxes** in the dashboard, where you can delete them.

To start every sandbox from a snapshot you made yourself, set `snapshot` on the account instead. The agent then does not manage snapshots for that account.

```jsonc
"options": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "snapshot": "my-snapshot:latest" }
```

## Approvals

OpenCode asks you before each of these actions. The resource is what a saved rule matches.

| Action                      | Resource                    | Asked when                                                                                                |
| --------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `gitterm.sandbox.provision` | `<account>:<provider>`      | Creating a sandbox                                                                                        |
| `gitterm.sandbox.public`    | `<account>`                 | Creating with public previews. "Always" is not offered. Not asked when the `publicPreviews` option is on. |
| `gitterm.sandbox.upload`    | `<account>:<checkout root>` | Syncing. The prompt lists modified, untracked, deleted, and excluded files.                               |
| `gitterm.sandbox.exec`      | `<account>:<sandbox id>`    | Running a command or starting a preview server. "Always" saves `<account>:*`.                             |
| `gitterm.sandbox.secret`    | Variable names              | Passing local environment variables with `secretEnv`                                                      |
| `gitterm.sandbox.browser`   | `<account>:<id>:<port>`     | Creating a loopback proxy for a private preview                                                           |
| `gitterm.sandbox.apply`     | Target path                 | Writing an artifact into the checkout. "Always" is not offered.                                           |
| `gitterm.sandbox.snapshot`  | `<account>:<checkout root>` | Saving or deleting a setup snapshot. Only with the `snapshots` option.                                    |

These need no approval: `sandbox_list`, `sandbox_job` (including cancelling a job), `sandbox_artifact` (it downloads to a staging directory only), and `sandbox_destroy`. A denied action stops before anything is uploaded, created, or written.

To approve routine work once, add `permissions` rules to `opencode.json`. This example allows creating sandboxes and running commands on the `e2b` account, and always denies public previews:

```jsonc
{
  "permissions": [
    { "action": "gitterm.sandbox.provision", "resource": "e2b:e2b", "effect": "allow" },
    { "action": "gitterm.sandbox.exec", "resource": "e2b:*", "effect": "allow" },
    { "action": "gitterm.sandbox.public", "resource": "*", "effect": "deny" },
  ],
}
```

The `publicPreviews` option skips the public-previews prompt, so a `deny` rule for `gitterm.sandbox.public` has no effect while it is on.

## Use the CLI instead

The Gitterm CLI has the same sandbox commands (`gitterm sandbox ...`) and the same settings, including `publicPreviews`. The difference: it reads them from `~/.config/gitterm/sandbox.json`, and keys come from `apiKeyEnv`, the name of an environment variable. A literal `apiKey` or `token` in that file is refused. See [CLI reference](/docs/reference/cli).

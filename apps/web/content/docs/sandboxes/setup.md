---
title: Sandbox setup
nav: Setup
description: Set up sandboxes for OpenCode, Pi, Codex or Claude Code, add a sandbox account, and choose what needs your approval.
---

This page walks you through giving your local agent remote sandboxes: set up your agents, choose the account sandboxes are billed to, and decide what needs your approval. Read [Sandboxes overview](/docs/sandboxes/overview) first if you are not sure what a sandbox is. Every field is listed in the [OpenCode plugin reference](/docs/reference/opencode-plugin#sandbox-options).

## Before you start

- OpenCode, Pi, or Codex or Claude Code (in T3 Code or on their own), and a project that is a Git checkout. Syncing uses Git to decide which files to upload.
- One of:
  - a Gitterm account, for a **managed** account billed to your plan, or
  - a key for E2B, Daytona, Vercel, Boat, exe.dev, or Railway, for a **direct** account.

Not sure which? See [Managed and direct accounts](/docs/concepts#managed-and-direct-accounts).

## Steps

1. Set up your agents:

   ```sh
   npx @gitterm/cli setup
   ```

   It asks about each agent it finds: it installs `@gitterm/opencode` for OpenCode and Gitterm's extension for Pi, adds the `gitterm-sandbox` skill for Codex, Claude Code and other agents, and offers to sign you in. Signed in, sandboxes are billed to your Gitterm plan and nothing else is needed: go to step 3.

2. To use your own provider account instead, run:

   ```sh
   gitterm sandbox setup
   ```

   Pick your Gitterm plan or a provider. If you already signed in to that provider's CLI (E2B, Daytona, exe.dev), it offers to use that login. Otherwise paste the key, which is saved in a file only you can read, or name the environment variable that holds it. Every agent then uses that account. `gitterm setup` asks the same.

   To write the settings by hand instead, they are the same everywhere; only where they go differs:

   - **OpenCode**: under `sandbox` in the plugin's options. Without that option, the plugin uses the file below too.

     ```jsonc
     {
       "plugins": [
         {
           "package": "@gitterm/opencode",
           "options": { "sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" } },
         },
       ],
     }
     ```

   - **Pi, Codex, Claude Code and the CLI**: in `~/.config/gitterm/sandbox.json`.

     ```json
     { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" }
     ```

   The examples below show these settings as `"sandbox": { ... }`. For the file, the object is the whole file. For [several accounts](#several-accounts), name them under `accounts`.

3. Optional: set [limits and exclusions](#limits-and-exclusions), turn on [setup snapshots](#setup-snapshots) or [public previews](/docs/sandboxes/jobs-and-previews#public-previews), and [pre-approve routine actions](#approvals).

4. Restart your agent and ask it:

   ```text
   Which sandbox account are you using?
   ```

   You should see the selected account and provider, where the key comes from, whether it is present, and who is charged. The key itself is never shown. In a terminal, `gitterm sandbox account` shows the same. If the key is missing, set the variable where the agent starts. For OpenCode, see [Environment variables](/docs/reference/opencode-plugin#environment-variables): its background service doesn't see variables set in your terminal.

## Direct accounts

A direct account uses your own provider key: it has `provider` and `apiKey`. The provider bills your account. No Gitterm login is needed.

Never type the key into the settings. Use a reference, which is filled in when the settings are read:

```jsonc
// From an environment variable (set it before starting your agent)
"apiKey": "{env:E2B_API_KEY}"

// From a file
"apiKey": "{file:~/.secrets/e2b}"
```

The key stays on your machine and is sent only to that provider's API. If it is empty or the provider rejects it, the tools fail with an error. They never fall back to another account.

If you already use the provider's CLI, you can leave `apiKey` out for E2B, Daytona, and exe.dev. The account then uses that CLI's login and is still billed to your own provider account:

| Provider | Sign in with                          | What the account uses                                                                    |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| E2B      | `e2b auth login`                      | The team API key the CLI saved in `~/.e2b/config.json`.                                  |
| Daytona  | `daytona login --api-key`             | The API key of the CLI's active profile. A browser login saves no key, so it won't work. |
| exe.dev  | An SSH key that `ssh exe.dev` accepts | A 30-day token signed on your machine with that key. Nothing is created in your account. |

An account with `serverUrl`, `token`, or `size` is a managed account and never uses a CLI login.

Some providers need more than `apiKey`:

| Provider | `provider` | Also required                                                  |
| -------- | ---------- | -------------------------------------------------------------- |
| E2B      | `e2b`      | Nothing                                                        |
| Daytona  | `daytona`  | Nothing                                                        |
| Vercel   | `vercel`   | `teamId`, `projectId`                                          |
| Boat     | `boat`     | Nothing                                                        |
| exe.dev  | `exedev`   | `"allowUnboundedLifetime": true`                               |
| Railway  | `railway`  | `projectId`, `environmentId`, `"allowUnboundedLifetime": true` |

exe.dev and Railway never delete a sandbox on their own. `allowUnboundedLifetime` is how you accept that a sandbox left behind by a crash keeps running and billing until you destroy it. Without it, creation is refused. Optional fields, such as an E2B template or a Vercel runtime, are in [Account fields](/docs/reference/opencode-plugin#account-fields).

## Managed accounts

A managed account has no `apiKey` and uses your Gitterm plan. The Gitterm deployment holds the provider account.

1. Sign in with the Gitterm CLI:

   ```sh
   npm install -g @gitterm/cli
   gitterm login
   ```

   You should see `Logged in as <your email>`. `gitterm setup` offers the same. Instead of logging in, you can set `GITTERM_API_TOKEN` before starting your agent.

2. That is all on gitterm.dev: with no sandbox settings, sandboxes use your login. To pick a size:

   ```jsonc
   "sandbox": { "size": "medium" }
   ```

   On a self-hosted deployment, add its address. Without `provider` it uses the deployment's default: the only provider it offers, or the one its admin prefers. Set `provider` to pick another:

   ```jsonc
   "sandbox": { "serverUrl": "https://gitterm.example.com", "provider": "daytona" }
   ```

The provider must be enabled on the deployment and allowed by your plan. If it isn't, the tools say which providers the deployment offers, and that adding `apiKey` uses your own account instead. Creation also checks your run allowance and your workspace limit, which counts sandboxes too.

> [!NOTE]
> On E2B, Daytona, Boat, and exe.dev, managed previews are served through Gitterm. They can be public, or private and open in your browser when you are signed in to Gitterm. See [Previews through Gitterm](/docs/sandboxes/jobs-and-previews#previews-through-gitterm).

## Pi settings

Pi's extension also reads a `gitterm` key from Pi's own settings: `~/.pi/agent/settings.json` for every project, and `.pi/settings.json` in a project for that project, which wins.

```json
{ "gitterm": { "sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" } } }
```

`sandbox` takes the same settings as above, or `false` to turn the sandbox tools off. `"cloud": false` turns `/cloud` and `/cloud-return` off. A sandbox account here is used instead of `~/.config/gitterm/sandbox.json`. Restart Pi after changing it.

## Turn Gitterm off for a project

OpenCode and Pi can do this in their own project settings: see [Turn a part off](/docs/reference/opencode-plugin#turn-a-part-off) and [Pi settings](#pi-settings). To turn it off for every agent on your machine at once, run this in the project:

```sh
gitterm project disable sandbox   # or: cloud, all
```

It applies to the whole checkout, on this machine only: nothing is written to the repository. It is saved in `~/.config/gitterm/projects.json`. In that project the OpenCode plugin and Pi's extension don't offer the sandbox tools (or `/cloud`), and the `gitterm` commands refuse, so agents using the skills stop too. Restart your agents after changing it. `gitterm project` shows what the project allows, and `gitterm project enable sandbox` turns it back on.

## Several accounts

Name each account under `accounts`, and pick the one the tools use with `account`:

```jsonc
"sandbox": {
  "account": "e2b",
  "accounts": {
    "e2b": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
    "gitterm": { "size": "medium" }
  }
}
```

The account name is what OpenCode's [approval rules](#approvals) match. A single account is named after its `provider`, or `gitterm` when it has none.

## Limits and exclusions

`limits` caps what the agent can start. `exclude` lists extra glob patterns that `sandbox_sync` never uploads. Secret-like files are always left out; see [Security](/docs/sandboxes/security#what-a-sandbox-never-receives). Set `maxSourceMiB` to change the checkout size limit before compression. It defaults to 100 MiB and accepts whole numbers from 1 to 1024.

```jsonc
"sandbox": {
  "provider": "e2b",
  "apiKey": "{env:E2B_API_KEY}",
  "limits": { "maxSandboxes": 2, "maxLifetimeMinutes": 60, "defaultLifetimeMinutes": 30, "maxJobMinutes": 30 },
  "exclude": ["fixtures/large/**"],
  "maxSourceMiB": 512
}
```

The `limits` values above are the defaults. What each limit does is in [Limits](/docs/reference/opencode-plugin#limits).

A larger limit has costs. The archive is built in memory, and the sandbox needs disk space for the archive plus two copies of the files. On Railway the compressed archive must stay under 32 MiB. Unpacking and checking the files in the sandbox must finish within 2 minutes on every provider.

## Setup snapshots

For a project with a slow setup, let the agent save a sandbox once dependencies are installed. The project's next sandboxes start from it, ready to run.

```jsonc
"sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "snapshots": true }
```

- Works on E2B, Daytona, Vercel and Boat, with your own key or a Gitterm plan, and on Gitterm's own machines. On a plan, snapshots need Pro or Growth; see [Plans](/docs/account/plans-and-billing#plans).
- The agent gets a `sandbox_snapshot` tool (in the CLI, `gitterm sandbox snapshot`). OpenCode asks before each save or delete; allow `gitterm.sandbox.snapshot` under [Approvals](#approvals) to skip the prompt.
- A project can have several snapshots, such as one with dependencies and one with dependencies and a database. New sandboxes start from the project's newest one unless the agent picks another.
- When a lockfile changed since a snapshot, the agent is told. It can then save a replacement, which deletes the old one. Until it does, the old one is still used.
- On Vercel, saving a snapshot ends the sandbox it was saved from.
- Snapshots stay in the provider account until deleted. On a Gitterm plan they are listed under **Snapshots** in the dashboard, where you can delete them.

To start every sandbox from a snapshot you made yourself, set `snapshot` on the account instead. The agent then does not manage snapshots for that account.

```jsonc
"sandbox": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}", "snapshot": "my-snapshot:latest" }
```

## Approvals

### OpenCode

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

### Pi

Pi asks before creating a sandbox, passing a secret with `secretEnv`, and making a preview public. Everything else runs as Pi's own tools do, without asking. A Pi run without a terminal (print or RPC mode) asks nothing.

### Codex, Claude Code and other agents

The `gitterm-sandbox` skill tells the agent to ask you before creating a sandbox, passing a secret, or making a preview public, and only then to pass `--yes`. The agent's own shell approvals apply to every `gitterm sandbox` command as well.

## The CLI

The `gitterm sandbox` commands do everything the tools do, from your terminal or a script, with the same settings file Pi and the skill use. See [CLI reference](/docs/reference/cli#sandboxes).

---
title: Agents
description: The agents a cloud workspace can run, how they get your model credentials, and how to give them saved configuration.
---

A cloud workspace runs one agent: OpenCode, or T3 Code (which drives Codex and Claude Code). Read this page to pick an agent, give it model credentials, and set config that every new workspace gets.

## Pick an agent

| Agent           | Key             | What you get                                                | Connect with                                                             |
| --------------- | --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| OpenCode        | `opencode`      | A remote OpenCode server                                    | Local TUI, OpenCode desktop app, or the OpenCode web app in your browser |
| OpenCode (TTYD) | `opencode-ttyd` | The OpenCode TUI in a browser terminal                      | Your browser, no local client                                            |
| T3 Code         | `t3code`        | A T3 Code server that runs Claude Code, Codex, and OpenCode | The T3 Code web or desktop app, through a one-time pairing link          |

In the dashboard, pick the agent under **Agent** when you create a workspace. In the SDK, pass the key as `agent` to `client.workspaces.create()`; the default is `opencode`.

Every workspace runs OpenCode 2 (the `@opencode/cli` package), including inside T3 Code.

### What each agent supports

| Feature                      | OpenCode | T3 Code                      |
| ---------------------------- | -------- | ---------------------------- |
| SDK runs (`client.runs.*`)   | Yes      | No                           |
| Slack and Discord bots       | Yes      | No                           |
| MCP connections from Gitterm | Yes      | No                           |
| `/cloud` session handoff     | Yes      | No                           |
| Saved agent config           | OpenCode | OpenCode, Claude Code, Codex |

T3 Code sessions don't move to the cloud. To use Codex or Claude Code in the cloud, create a T3 Code workspace and start a new thread there. See [Move a session to the cloud](/docs/workspaces/move-a-session).

> [!NOTE]
> T3 Code workspaces need subdomain routing. A self-hosted deployment with `ROUTING_MODE=path` rejects them. See [Self-hosting](/docs/self-hosting/overview#routing).

## Model credentials

Workspaces run on your own model keys and subscriptions. Add them under **Models** in the dashboard.

- **API keys:** Anthropic, OpenAI, Google AI, OpenRouter, xAI, OpenCode Zen, and many more.
- **Subscriptions:** ChatGPT (shown as Codex), OpenCode Console, GitHub Copilot, and SuperGrok. Connect these in the dashboard; the SDK can't add them.

Each credential has a label, and each provider has one default credential. A workspace created without a `models` choice gets every saved credential, under its dashboard label, with each provider's default selected. Inside the workspace, `opencode auth switch` changes the active account.

### Choose credentials from the SDK

Pass `models` to `client.workspaces.create()`:

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  models: {
    default: "anthropic/<model-id>",
    inherit: "none", // only the providers listed here get credentials
    providers: {
      anthropic: { source: "default" },
      openai: { source: "saved", label: "work" },
      google: { source: "apiKey", apiKey: process.env.GOOGLE_API_KEY! },
    },
  },
});
```

`<model-id>` is the model's id at that provider.

| Field       | Required | Default | What it does                                                                                                |
| ----------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `default`   | No       | None    | The workspace's default model, as `provider/model`                                                          |
| `inherit`   | No       | `none`  | `none`: only listed providers get credentials. `defaults`: also every unlisted provider's saved credentials |
| `providers` | No       | None    | One credential source per provider key, from the table below                                                |

| Source                         | Meaning                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `{ source: "default" }`        | The provider's default saved credential                   |
| `{ source: "saved", label }`   | A saved credential, by its dashboard label                |
| `{ source: "apiKey", apiKey }` | A key for this workspace only. It is not saved in Gitterm |

Use the provider key `openai` for both OpenAI API keys and ChatGPT subscriptions.

### How subscriptions are refreshed

Subscriptions that rotate refresh tokens (ChatGPT, OpenCode Console, SuperGrok) stay encrypted in Gitterm. A workspace gets a short-lived access token and asks Gitterm for a new one when it expires. Several workspaces can share one account without signing each other out.

In T3 Code, Claude Code and Codex use their own sign-in, and Gitterm does not refresh it. For long-lived or multi-workspace use, prefer API keys, or sign in separately in T3 Code's provider settings. If an older saved ChatGPT credential fails in T3 Code, reconnect it under **Models**.

## Saved agent config

Save config once under **Settings → Agent defaults** and every new workspace of the matching agent gets it. Existing workspaces keep the config they were created with.

| Config      | Applies to                      | Written to                         |
| ----------- | ------------------------------- | ---------------------------------- |
| OpenCode    | OpenCode and T3 Code workspaces | `~/.config/opencode/opencode.json` |
| Claude Code | T3 Code workspaces              | `~/.claude/settings.json`          |
| Codex       | T3 Code workspaces              | `~/.codex/config.toml`             |

You write each config as JSON. Gitterm converts Codex config to TOML. Examples:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "theme": "opencode",
  "update": "notify"
}
```

```json
{
  "permissions": {
    "allow": ["Bash(git *)", "Read", "Edit"]
  }
}
```

### Commit attribution

The same page has the switch **Attribute GitTerm for commits made in workspaces**. It is on by default: you are the commit author and Gitterm is the committer. Turn it off to be both. It applies to new workspaces.

### Per-workspace OpenCode settings from the SDK

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  opencode: {
    config: { permission: { edit: "allow", bash: "allow" } }, // merged over your saved config
    plugins: ["@acme/opencode-browser@1.2.3"],
    skills: [{ name: "release-demo", content: releaseDemoSkillMarkdown }], // a SKILL.md body
  },
  additionalAgentInstructions: "Keep answers short.",
});
```

`additionalAgentInstructions` is appended to the workspace's global `AGENTS.md`. Put project knowledge in an `AGENTS.md` in the repository instead; the agent reads it on its own.

## Related

- [Cloud workspaces](/docs/workspaces/overview)
- [Connect to a workspace](/docs/workspaces/connect)
- [Connections](/docs/integrations/connections)
- [SDK reference](/docs/reference/sdk#create-options)

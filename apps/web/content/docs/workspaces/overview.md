---
title: Cloud workspaces
nav: Overview
description: What a cloud workspace is, how to create one from the dashboard or the SDK, and which providers can run it.
---

A cloud workspace is a remote machine that runs a coding agent on one of your repositories. Read this page before you create your first workspace, or when you need to pick a provider.

The agent itself runs in the workspace: OpenCode, or T3 Code (which drives Codex and Claude Code). That is the difference from a [sandbox](/docs/sandboxes/overview), where the agent stays on your machine and only commands run remotely.

## What a workspace has

- A checkout of your repository, on the branch you pick.
- One agent, started with your model credentials. See [Agents](/docs/workspaces/agents).
- A URL to open in a browser or connect a local client to. See [Connect to a workspace](/docs/workspaces/connect).
- Optional connections: GitHub, Google Cloud, MCP servers. See [Connections](/docs/integrations/connections).
- Preview URLs for any port. See [Previews](/docs/workspaces/previews).
- A lifecycle: it runs, pauses when idle, resumes, and is terminated. See [Lifecycle](/docs/workspaces/lifecycle).

## Ways to create one

| From         | How                                  | Use it for                                                                                      |
| ------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Dashboard    | **Workspaces → New workspace**       | Day-to-day work                                                                                 |
| SDK          | `client.workspaces.create()`         | Automation, bots, CI                                                                            |
| Cloud plugin | `/cloud` in a local OpenCode session | Continuing a session you already started. See [Move a session](/docs/workspaces/move-a-session) |

The `gitterm` CLI lists, pauses, restarts and terminates workspaces. It does not create them.

## Create a workspace from the dashboard

Before you start:

- Add a model key or subscription under **Models**. See [Agents](/docs/workspaces/agents#model-credentials).
- For a private repository, connect GitHub under **Integrations**. See [Connections](/docs/integrations/connections#github).

Steps:

1. Open **Workspaces** and click **New workspace**.
2. Enter the repository. Optionally set a **Branch**; leave it empty to use the repository default.
3. Pick an **Agent** and a **Cloud** provider. Where the provider offers them, pick a **Region** and a **Machine** size.
4. Under **GitHub repository access**, pick a connection. **None (public repos only)** works for public repositories only.
5. Optional: open **Add integrations** to attach a **Google Cloud identity** or **MCP servers and Executor**.
6. Optional: turn on **Keep running when idle**. See [Lifecycle](/docs/workspaces/lifecycle#keep-running-when-idle).
7. Click **Create workspace**.

You should see the new workspace's card under **Workspaces**. Once it is running, the card shows buttons to connect. See [Connect to a workspace](/docs/workspaces/connect).

## Create a workspace from the SDK

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient({ token: process.env.GITTERM_API_TOKEN });

const { workspace, runtime } = await client.workspaces.create({
  repo: "https://github.com/acme/product",
  branch: "main",
  agent: "opencode",
  provider: { type: "e2b" },
  connections: ["github"],
});

console.log(workspace.status, runtime.url);
```

Only `repo` is required. Without `agent`, the server uses `opencode`. Without `provider`, it uses your default provider and that provider's default machine size. For every option, see the [SDK reference](/docs/reference/sdk#create-options).

## Providers

The deployment's admin enables providers, and you can pick only from those. Set your default under **Compute** in the dashboard.

| Provider           | Key          | Kind    |
| ------------------ | ------------ | ------- |
| E2B                | `e2b`        | Sandbox |
| Daytona            | `daytona`    | Sandbox |
| Vercel Sandbox     | `vercel`     | Sandbox |
| Boat               | `boat`       | Sandbox |
| exe.dev            | `exedev`     | Sandbox |
| Cloudflare Sandbox | `cloudflare` | Sandbox |
| Railway            | `railway`    | Compute |
| AWS                | `aws`        | Compute |

- Sandbox providers return a `running` workspace right away. Railway reports `pending` until its deployment succeeds, usually within a minute.
- Whether files survive a pause depends on the provider. See [Lifecycle](/docs/workspaces/lifecycle#what-is-kept-while-paused).
- The admin sets the machine sizes. `client.catalog.workspaceOptions()` lists the sizes you may use, with `vcpus` and `memoryGb`.
- On managed Gitterm, your plan limits which providers and sizes you can use. See [Plans and billing](/docs/account/plans-and-billing#plans).

## Related

- [Agents](/docs/workspaces/agents)
- [Connect to a workspace](/docs/workspaces/connect)
- [Lifecycle](/docs/workspaces/lifecycle)
- [Plans and billing](/docs/account/plans-and-billing)

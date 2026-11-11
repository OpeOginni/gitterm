---
title: Concepts
description: Short definitions of sandboxes, cloud workspaces, /cloud handoff, account modes, providers, and cleanup.
---

This page defines the terms the rest of the docs use. Read it once before setting things up, or come back when a word is unclear.

## Sandbox, cloud workspace, and `/cloud`

|                            | Sandbox                                            | Cloud workspace                           | `/cloud` handoff                              |
| -------------------------- | -------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| Where the agent runs       | On your machine                                    | In the cloud                              | In the cloud, after the move                  |
| What runs remotely         | Only the commands your agent sends                 | OpenCode or T3 Code, with your repository | OpenCode, with your conversation and checkout |
| Model credentials remotely | None                                               | Yours, configured in Gitterm              | Yours, configured in Gitterm                  |
| How you start it           | `sandbox_*` tools from `@gitterm/opencode-sandbox` | The dashboard or the SDK                  | `/cloud` from `@gitterm/opencode-cloud`       |

- **Sandbox.** A plain remote machine your local agent uses for builds, tests, and preview servers. It runs no coding agent. See [Sandboxes overview](/docs/sandboxes/overview).
- **Cloud workspace.** A remote machine that runs the agent itself: OpenCode, or T3 Code (which drives Codex and Claude Code). You open it in the browser or connect a local client. See [Cloud workspaces](/docs/workspaces/overview).
- **`/cloud` handoff.** Moves one OpenCode session into a cloud workspace, and `/cloud-return` brings it back with the cloud's commits, changes and conversation. Nothing syncs in between: later local edits do not go up, and cloud changes come back only when you return the session, which replaces the local state rather than merging. T3 Code sessions do not move; start a new cloud agent instead. See [Move a session](/docs/workspaces/move-a-session) and [Bring a session back](/docs/workspaces/return-a-session).

## Managed and direct accounts

A sandbox account says whose provider account runs the sandbox and who pays. An account with an `apiKey` is direct; one without is managed. You can configure several accounts and pick one by name.

| Account | Set up with                                             | Who holds the provider account | Who pays              | Needs a Gitterm account |
| ------- | ------------------------------------------------------- | ------------------------------ | --------------------- | ----------------------- |
| Direct  | `provider` and `apiKey`                                 | You (bring your own key)       | Your provider account | No                      |
| Managed | No `apiKey`; optionally `size`, `serverUrl`, `provider` | The Gitterm deployment         | Your Gitterm plan     | Yes                     |

Every sandbox belongs to the account that created it. Gitterm never falls back to another account: using a sandbox from another account, or a missing or rejected key, is an error. See [Setup](/docs/sandboxes/setup).

Cloud workspaces always run through a Gitterm account.

> [!NOTE]
> With a managed account on E2B, Daytona, Boat, or exe.dev, Gitterm serves sandbox previews itself. A private preview opens in your browser when you are signed in to Gitterm. See [Previews through Gitterm](/docs/sandboxes/jobs-and-previews#previews-through-gitterm).

## Providers

A provider is the company whose machines run the sandbox or workspace. Sandboxes support E2B, Daytona, Vercel, Boat, exe.dev, and Railway with either kind of account, and AWS with managed accounts only. Cloudflare sandboxes are planned. See [Providers](/docs/sandboxes/providers).

## Sandbox terms

- **Lifetime.** How long a sandbox may exist, set when it is created (30 minutes by default).
- **Sync.** Uploading your current working tree to `~/project` in the sandbox. Each sync is recorded as a **snapshot**: a list of file paths and hashes.
- **Job.** One command running in the sandbox. Jobs keep running if OpenCode restarts. See [Jobs and previews](/docs/sandboxes/jobs-and-previews#jobs).
- **Preview.** A URL for a port in the sandbox, such as a dev server. Private by default; whether it can be public depends on the provider and the kind of account. See [Previews](/docs/sandboxes/jobs-and-previews#previews).
- **Artifact.** A file a job produced, downloaded to your machine and then applied to your checkout. See [Artifacts](/docs/sandboxes/artifacts).

## What stays local

With sandboxes, these never leave your machine: the conversation, Git history, your model credentials, and files that look like secrets (such as `.env` files and private keys). See [Security](/docs/sandboxes/security#what-a-sandbox-never-receives).

With `/cloud`, the selected conversation and Git history do move, by design. Your local files and sessions stay unchanged until you run `/cloud-return`.

## Lifetimes and cleanup

- **Sandboxes** end at their lifetime: Gitterm terminates managed ones, and the provider ends direct ones where it can. exe.dev and Railway never do, so destroy those yourself. See [Cleanup](/docs/sandboxes/security#cleanup).
- **Cloud workspaces** run until you pause or terminate them, or until an idle timeout stops them. See [Lifecycle](/docs/workspaces/lifecycle).

> [!WARNING]
> Closing OpenCode does not stop sandboxes or workspaces. They keep running, and can be charged, until destroyed, terminated, or their lifetime ends.

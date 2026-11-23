---
title: Sandboxes overview
nav: Overview
description: How your local agent (OpenCode, Pi, Codex or Claude Code) runs builds, tests, and previews in a remote sandbox while the conversation and checkout stay on your machine.
---

This page explains what a Gitterm sandbox is, how a typical session goes, and when to use one instead of `/cloud`. Read it before [Setup](/docs/sandboxes/setup).

## What a sandbox is

A sandbox is a plain remote machine that your local agent sends commands to. The conversation and your checkout stay on your machine. Only the commands run remotely.

| Agent                                       | How it uses sandboxes                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OpenCode                                    | `sandbox_*` tools from `@gitterm/opencode`, and a list of the checkout's sandboxes in the right sidebar |
| Pi                                          | The same `sandbox_*` tools, from Gitterm's Pi extension                                                 |
| Codex and Claude Code (in T3 Code or alone) | The `gitterm sandbox` commands, which the `gitterm-sandbox` skill teaches them                          |

`npx @gitterm/cli setup` sets up every agent it finds. See [Setup](/docs/sandboxes/setup).

A sandbox:

- runs no coding agent and receives no model credentials
- gets only the working tree you sync and the commands you run
- uses a plain image, such as `node:22-bookworm-slim` (see [Providers](/docs/sandboxes/providers#capabilities))

Local commands are unchanged. The agent keeps running shell commands on your machine as before, and uses the sandbox only when it calls a `sandbox_*` tool or a `gitterm sandbox` command.

## A typical session

1. `sandbox_create` starts a sandbox with a lifetime (30 minutes by default).
2. `sandbox_sync` uploads your working tree, including uncommitted changes, to `~/project` in the sandbox.
3. `sandbox_exec` runs a command such as `npm test` as a job and returns its output.
4. `sandbox_preview` exposes a port, optionally starting a dev server first.
5. `sandbox_artifact` downloads a file a job produced, and `sandbox_apply` copies it into your checkout.
6. `sandbox_destroy` deletes the sandbox once you are done.

Your agent asks before steps that cost money or share more than the job needs, such as creating a sandbox, passing a secret or making a preview public. OpenCode also asks before uploads, commands and changes to your checkout, and you can pre-approve routine steps; see [Approvals](/docs/sandboxes/setup#approvals).

## Sandbox or `/cloud`?

| You want to                                                   | Use               |
| ------------------------------------------------------------- | ----------------- |
| Keep the agent local and run slow or heavy commands elsewhere | A sandbox         |
| Show a running app from a branch you have not pushed          | A sandbox preview |
| Keep the agent running after you close your laptop            | `/cloud`          |
| Continue the same conversation from another device            | `/cloud`          |

`/cloud` moves the conversation and checkout into a cloud workspace that runs your agent. See [Concepts](/docs/concepts#sandbox-cloud-workspace-and-cloud).

## Where to go next

- [Setup](/docs/sandboxes/setup): set up your agents and add an account.
- [Tools](/docs/sandboxes/tools): every `sandbox_*` tool and its arguments.
- [Providers](/docs/sandboxes/providers): what each provider supports.
- [Security](/docs/sandboxes/security): what a sandbox receives, cleanup, and charges.

---
title: Introduction
description: What Gitterm is, who it is for, and where to go next.
---

Gitterm gives your coding agents more computers, from the cloud providers you choose: sandboxes for the agent on your laptop, and cloud workspaces for agents that run in the cloud. Gitterm does not run its own machines. Every sandbox and workspace runs on a provider such as E2B, Daytona, Vercel or AWS, and Gitterm sits in between, so you can switch providers without changing how you work. This page explains both and points you to the right page to start.

## Two products

**Sandboxes, for the agent on your laptop.** Gitterm gives your local agent a set of `sandbox_*` tools: OpenCode through `@gitterm/opencode`, Pi through Gitterm's extension, and Codex and Claude Code through the `gitterm sandbox` commands. The agent uses them to run builds, tests, and preview servers in a remote sandbox. The conversation and your checkout stay on your machine. A sandbox runs no coding agent and receives no model credentials. See [Sandboxes overview](/docs/sandboxes/overview).

**Cloud workspaces, for agents that run in the cloud.** A cloud workspace runs OpenCode, or T3 Code (which drives Codex and Claude Code), on a remote provider. You open it in the browser or connect from a local client, so you can keep working from any device with your own model keys. You can also move a local OpenCode or Pi session into a workspace with `/cloud`, or ask another agent to move its session. See [Cloud workspaces](/docs/workspaces/overview).

## Who it is for

- You use OpenCode locally and want heavy or slow commands to run on another machine, without handing the conversation to a remote agent.
- You want an agent that keeps running when your laptop is closed, or that you can reach from another device.
- You want to run Gitterm yourself. It is open source and self-hostable; see [Self-hosting](/docs/self-hosting/overview).

## Who pays for compute

Sandboxes work without a Gitterm account. Use your own provider key (a **direct** account) and the provider bills you, or use your Gitterm plan (a **managed** account). Cloud workspaces always run through a Gitterm account. See [Managed and direct accounts](/docs/concepts#managed-and-direct-accounts).

## Where to go next

- [Quickstart](/docs/quickstart): run your first remote command, or start a cloud workspace.
- [Concepts](/docs/concepts): the terms these docs use, on one page.
- [Sandbox setup](/docs/sandboxes/setup): install the plugin, add an account, and set approvals.
- [OpenCode plugin reference](/docs/reference/opencode-plugin): every option, variable, tool, and command.

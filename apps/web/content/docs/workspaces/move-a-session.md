---
title: Move a session to the cloud
nav: Move a session
description: Use /cloud to continue a local OpenCode session in a cloud workspace, what it transfers, how to reconnect, and its limits.
---

`/cloud` moves one local OpenCode session into a new cloud workspace: the conversation and your checkout. Use it to hand off work you already started, so you can keep going from another device.

The move is one-way:

- Nothing moves back. Cloud changes are not merged into your local checkout.
- Later local edits are not uploaded to the workspace.
- Only OpenCode sessions move. T3 Code sessions (Codex, Claude Code) don't. To use those agents in the cloud, create a [T3 Code workspace](/docs/workspaces/agents) and start a new thread there.

## Before you start

- The cloud plugin is installed:

  ```sh
  opencode plugin add @gitterm/opencode-cloud
  ```

  See the [Cloud plugin reference](/docs/reference/cloud-plugin).

- You are signed in with `gitterm login`, or `GITTERM_API_TOKEN` is set before OpenCode starts.
- Gitterm has a model credential under **Models**, and for a private repository, a GitHub connection under **Integrations**.
- The repository's `origin` remote is a credential-free HTTPS URL or a GitHub SSH URL.
- OpenCode on your computer is up to date.

## Move the session

1. Stop the agent, and answer or cancel any pending question.
2. Run:

   ```text
   /cloud
   ```

3. Choose whether to include uncommitted changes. If other active sessions share the checkout, you are warned that their changes may be included too.
4. Review the repository, commit, changed paths and snapshot size. Approve the upload and the cloud compute.
5. Open the connection link in your browser, or paste the one-time link into **Connect server** in the OpenCode desktop app. Select the imported session.

You should see your conversation in the cloud workspace, on a new `gitterm/…` branch with your checkout restored. No agent run starts on its own. Your local files and sessions are unchanged.

## What transfers

| Moves to the cloud                                                        | Stays behind                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| The selected conversation's history                                       | Other conversations and child sessions               |
| Git history reachable from the current commit, including unpushed commits | Running processes and terminals                      |
| Staged and unstaged changes, if you opt in (kept separate)                | Ignored files, such as an ignored `.env`             |
| Binary edits, deletions, and untracked files that aren't ignored          | Global OpenCode settings and local credential stores |

You don't need to commit or push first. Config that lives in the repository travels with the code. The workspace uses the model credentials you saved in Gitterm; if your local model isn't available there, pick another one.

Uncommitted changes belong to the checkout, not to one conversation. If several sessions or editors write to the same checkout, pause them before you move.

## Reconnect later

Run `/cloud` again in the same session. After a successful move it:

- opens the existing workspace, with its current files and conversation,
- resumes the workspace first if it is paused,
- gives you a fresh link.

It does not create another workspace or upload newer local edits.

Links work once and expire after five minutes; run `/cloud` again for a new one. If pairing isn't available, use the connection details on the workspace card in the dashboard. See [Connect to a workspace](/docs/workspaces/connect).

## Choose the provider and connections

`/cloud` uses your default provider. To pick another provider, attach connections, or name the workspace, set the plugin's options in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@gitterm/opencode-cloud",
      "options": {
        "provider": { "type": "e2b" },
        "connections": ["github"],
        "persistent": true
      }
    }
  ]
}
```

Every option is listed in the [Cloud plugin reference](/docs/reference/cloud-plugin#options).

## Limits

- `/cloud` refuses to run inside a Gitterm workspace. Run it from your local OpenCode.
- The checkout snapshot and the conversation history are each limited to 25 MiB. Git history counts toward the checkout limit.
- Merge conflicts, submodules, intent-to-add files, and untracked symlinks or special files are not supported. Resolve or remove them first.
- Common secret file names and private-key markers in changed files are blocked. This is not full secret scanning: conversation history, tracked files and Git history can still hold secrets. Review the upload before you approve it.

> [!WARNING]
> The cloud workspace keeps running, and can be billed, on its own. Pause or terminate it when you are done. If a move fails after the workspace was created, the plugin does not delete it: check the workspace or attempt id in the error before you retry.

## Related

- [Cloud plugin reference](/docs/reference/cloud-plugin)
- [Lifecycle](/docs/workspaces/lifecycle)
- [Connections](/docs/integrations/connections)

---
title: Move a session to the cloud
nav: Move a session
description: Use /cloud to continue a local OpenCode session in a cloud workspace, what it transfers, how to reconnect and retry, and its limits.
---

`/cloud` moves one local OpenCode session into a cloud workspace: the conversation and your checkout. Use it to hand off work you already started, so the agent keeps going while you are away and you can check in from another device. When you are done, [`/cloud-return`](/docs/workspaces/return-a-session) brings the session and the cloud's work back.

While the session is in the cloud, nothing syncs: later local edits are not uploaded, and cloud changes reach your checkout only when you return the session. Only OpenCode sessions move. T3 Code sessions (Codex, Claude Code) don't; to use those agents in the cloud, create a [T3 Code workspace](/docs/workspaces/agents) and start a new thread there.

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
2. In OpenCode, type `/cloud`.
3. Choose whether to include uncommitted changes. If other active sessions share the checkout, you are warned that their changes may be included too.
4. Review the repository, commit, changed paths and upload size. Approve the upload and the cloud compute.
5. Open the connection link in your browser, or paste the one-time link into **Connect server** in the OpenCode desktop app. Select the imported session.

You should see your conversation in the cloud workspace, on the same branch name as your local checkout, with your checkout restored. No agent run starts on its own. Your local files and sessions are unchanged.

If you kept a [project snapshot](#start-from-a-project-snapshot) for this repository, the workspace starts from it.

## What transfers

| Moves to the cloud                                               | Stays behind                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| The selected conversation's history                              | Other conversations and child sessions               |
| Commits that are not on `origin`'s default branch, unpushed too  | Running processes and terminals                      |
| Staged and unstaged changes, if you opt in (kept separate)       | Ignored files, such as an ignored `.env`             |
| Binary edits, deletions, and untracked files that aren't ignored | Global OpenCode settings and local credential stores |

You don't need to commit or push first. Config that lives in the repository travels with the code. Only the commits the cloud clone lacks are uploaded; if it lacks the commits they build on, `/cloud` sends the whole history instead.

The workspace uses the model credentials you saved in Gitterm. If the cloud offers the model the session was using, the session keeps it. If not, the session opens on the cloud's default model, and you can pick another.

Uncommitted changes belong to the checkout, not to one conversation. If several sessions or editors write to the same checkout, pause them before you move.

## While the session is in the cloud

- In the OpenCode terminal, the session's sidebar shows a **Cloud** block, and a line above the prompt says what the cloud agent is doing: working, needs your input, idle, paused, or deleted.
- You get a notification when the cloud agent finishes or needs your input.
- If you send a message in that session locally, OpenCode asks first, because the cloud session would not see it.
- Checking the cloud's status does not keep the workspace awake. An idle workspace still pauses on its own. See [Idle pausing](/docs/workspaces/lifecycle#idle-pausing).

The sidebar, status line and notifications are in the OpenCode terminal. The OpenCode desktop app gets the check before sending and both commands.

## Reconnect later

Run `/cloud` again in the same session. While the session is in the cloud it:

- opens the existing workspace, with its current files and conversation,
- resumes the workspace first if it is paused,
- gives you a fresh link.

It does not create another workspace or upload newer local edits.

Links work once and expire after five minutes; run `/cloud` again for a new one. If pairing isn't available, use the connection details on the workspace's row in the dashboard. See [Connect to a workspace](/docs/workspaces/connect).

## If a move fails

Run `/cloud` again in the same session and choose to retry. The retry continues in the workspace the failed attempt created, instead of starting a second one. It replaces what that attempt left with your current checkout and conversation.

A retry stops and leaves the cloud as it is if anything happened there since the failed attempt: a commit or edit in the cloud checkout, a message, a queued prompt, or a running agent. Continue in the cloud, or choose not to retry, which starts a new workspace. The earlier workspace is not deleted by that, so remove it in Gitterm.

## Start from a project snapshot

When you [return a session](/docs/workspaces/return-a-session), you can keep the workspace's disk as the snapshot for its repository. The next `/cloud` for that repository then starts from it: the agent is already installed and files Git ignores, such as installed dependencies and build output, are in place. The repository is brought up to date with `origin` and your checkout is restored on top, as usual.

- A snapshot is used only when the new workspace would get the same provider, image and machine size. Otherwise the workspace is created fresh.
- If a snapshot no longer starts, `/cloud` creates the workspace fresh instead.
- Project snapshots work on E2B, Daytona, Vercel, Boat and Gitterm's own machines, on plans that include snapshots. See [Plans and billing](/docs/account/plans-and-billing#plans).

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
- The upload and the conversation history are each limited to 25 MiB. Commits count toward the upload.
- Merge conflicts, submodules, intent-to-add files, and untracked symlinks or special files are not supported. Resolve or remove them first.
- Common secret file names and private-key markers in changed files are blocked. This is not full secret scanning: conversation history, tracked files and Git history can still hold secrets. Review the upload before you approve it.

> [!WARNING]
> The cloud workspace keeps running, and can be billed, on its own. Return the session, or pause or terminate the workspace, when you are done. A failed move does not delete the workspace it created: retry with `/cloud`, or check the workspace or attempt id in the error.

## Related

- [Bring a session back](/docs/workspaces/return-a-session)
- [Cloud plugin reference](/docs/reference/cloud-plugin)
- [Lifecycle](/docs/workspaces/lifecycle)
- [Connections](/docs/integrations/connections)

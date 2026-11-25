---
title: Move a session to the cloud
nav: Move a session
description: Use /cloud to continue a local OpenCode session in a cloud workspace, what it transfers, how to reconnect and retry, and its limits.
---

`/cloud` moves one local OpenCode session into a cloud workspace: the conversation and your checkout. Use it to hand off work you already started, so the agent keeps going while you are away and you can check in from another device. When you are done, [`/cloud-return`](/docs/workspaces/return-a-session) brings the session and the cloud's work back.

While the session is in the cloud, nothing syncs: later local edits are not uploaded, and cloud changes reach your checkout only when you return the session. This page covers OpenCode. Other agents move with the `gitterm` CLI; see [Other agents](#other-agents).

## Before you start

- Gitterm's OpenCode plugin is installed:

  ```sh
  npx @gitterm/cli setup
  ```

  It installs `@gitterm/opencode`, sets up your other agents and signs you in. `opencode plugin add @gitterm/opencode` installs only the plugin. See the [OpenCode plugin reference](/docs/reference/opencode-plugin).

- You have a Gitterm account. If you aren't signed in, `/cloud` asks you to sign in or create one first.
- Recommended: a model under **Models** in Gitterm. Your local model keys don't move; without one, the cloud agent uses free models. `/cloud` suggests adding one if you have none.
- For a private repository, a GitHub connection under **Integrations** is best. Without one, `/cloud` uploads the repository's history instead (up to 25 MiB), and the cloud checkout has no remote, so the agent can't push or pull there.
- If the repository has an `origin` remote, it is a credential-free HTTPS URL or a GitHub SSH URL.
- OpenCode 2.3.0 or newer.
- Moving isn't turned off for the project with `gitterm project disable cloud`; see [Turn Gitterm off for a project](/docs/sandboxes/setup#turn-gitterm-off-for-a-project).

## Move the session

1. In OpenCode, type `/cloud`. Text after it is sent to the cloud agent: `/cloud finish the migration and run the tests`.
2. If you have uncommitted changes, choose whether to bring them. If other active sessions share the checkout, you are warned that their changes may be included too.
3. A dialog shows each step. Esc cancels and deletes the workspace that was just created.
4. Scan the QR code with your phone, or open the link on your computer. You can also paste the link into **Connect server** in the OpenCode desktop app.

The agent doesn't have to be idle. If it is working, `/cloud` stops it here, and it continues where it left off in the cloud.

You should see your conversation in the cloud workspace, on the same branch name as your local checkout, with your checkout restored. The agent there is told the session moved, so it doesn't mistake earlier answers about your machine for errors. Without a message, and if the agent wasn't working, nothing runs until you send something. Your local files and sessions are unchanged.

`/cloud` refuses to move a session with background commands running or a message waiting to be sent. Let them finish, or stop them, first.

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

`/cloud` undoes what it did: it deletes the workspace it created, and if it stopped the agent, the agent continues here. The error says which step failed and why. Run `/cloud` again to start over.

If the workspace could not be deleted, the error names it: delete it in Gitterm. If OpenCode closed during a move, the next `/cloud` in that session deletes what the move left before it starts again.

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
      "package": "@gitterm/opencode",
      "options": {
        "provider": { "type": "e2b" },
        "connections": ["github"],
        "persistent": true
      }
    }
  ]
}
```

Every option is listed in the [OpenCode plugin reference](/docs/reference/opencode-plugin#options).

## Limits

- `/cloud` refuses to run inside a Gitterm workspace. Run it from your local OpenCode.
- The upload and the conversation history are each limited to 25 MiB. Commits count toward the upload.
- Merge conflicts, submodules, intent-to-add files, and untracked symlinks or special files are not supported. Resolve or remove them first.
- Common secret file names and private-key markers in changed files are blocked. This is not full secret scanning: conversation history, tracked files and Git history can still hold secrets.

> [!WARNING]
> The cloud workspace keeps running, and can be billed, on its own. Return the session, or pause or delete the workspace, when you are done.

## Related

- [Bring a session back](/docs/workspaces/return-a-session)
- [OpenCode plugin reference](/docs/reference/opencode-plugin)
- [Lifecycle](/docs/workspaces/lifecycle)
- [Connections](/docs/integrations/connections)

## Other agents

T3 Code threads that run Claude Code, and Pi sessions, move with the `gitterm` CLI and the `gitterm-cloud` skill. Codex threads don't move yet. An OpenCode session can also move with `gitterm move`, from its own shell or with `--agent opencode --session <id>`.

1. Set up your agents and sign in, once:

   ```sh
   npx @gitterm/cli setup
   ```

   It asks before setting up each agent it finds: the OpenCode plugin, the Pi extension and T3 Code's linked environments. It also installs the `gitterm-cloud` skill for agents that read skills, and offers to sign you in or create an account. `--yes` sets up every agent found without asking.

2. In the thread, ask the agent to move to the cloud. It runs `gitterm move "<what to do next>"`, which copies the checkout and the conversation into a new T3 Code workspace and prints a link to the cloud thread. Your T3 Code is linked to the workspace, so the link opens there.
3. To bring it back, ask the same thread to return. It runs `gitterm return`, which waits until its reply ends, then brings the cloud's commits, changes and conversation back into that thread.

In Pi, `gitterm setup` also installs GitTerm's Pi extension: type `/cloud` to move a session and `/cloud-return` to bring it back. Bring a Pi session back with `/cloud-return`, not by asking the agent: Pi keeps the open session and would write over the returned one. In the workspace, Pi runs in a tmux session the browser terminal attaches to, so it keeps working while the tab is closed.

`gitterm moves` lists sessions that are in the cloud. To hand tasks to a cloud machine instead of moving a thread, `gitterm t3 link` creates a workspace linked to your T3 Code for `delegate_task`, and `gitterm t3 unlink <workspaceId>` deletes it.

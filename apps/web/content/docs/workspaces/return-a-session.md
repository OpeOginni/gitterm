---
title: Bring a session back from the cloud
nav: Bring a session back
description: Use /cloud-return to bring a session and the cloud's commits, changes and conversation back to your machine, what it asks, what it keeps, and project snapshots.
---

`/cloud-return` is the way back from [`/cloud`](/docs/workspaces/move-a-session). It brings the cloud's new commits, its uncommitted changes and its conversation to your local checkout and session, then ends the cloud workspace. Use it when the cloud agent has finished and you want to continue on your machine.

The command appears in OpenCode only while a session of this checkout is in the cloud.

## Bring the session back

1. Let the cloud agent finish, or stop it in the cloud. Answer or cancel any question it is waiting on.
2. In the local session, type `/cloud-return`.
3. Answer the questions, if any (see below).
4. Choose what happens to the cloud workspace.

You should see the cloud conversation in your local session, and your checkout on the cloud's commit with the cloud's uncommitted changes. The session is no longer marked as being in the cloud, and the next `/cloud` starts a new handoff.

## What it asks

If your checkout and conversation are as you handed them off, nothing is asked: the cloud's state replaces them.

If you changed them since, `/cloud-return` asks before replacing anything, and keeps what it replaces:

| You did this locally after `/cloud`      | It asks                                      | It keeps                                             |
| ---------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Edited files or left uncommitted changes | Replace your local changes with the cloud's? | Your uncommitted changes, in a Git stash             |
| Made commits                             | (the same question)                          | Those commits, on a `gitterm/before-return-…` branch |
| Sent messages in the session             | Replace this conversation with the cloud's?  | Your local conversation, as a copy of the session    |

Answering no to any question changes nothing, here or in the cloud. If applying the cloud's state fails, your checkout is put back as it was.

`/cloud-return` replaces; it does not merge. To combine both sides, use Git: the kept stash and branch hold your local work.

## What happens to the workspace

Its work is now on your machine, so the workspace is deleted at the end. Files Git ignores in the cloud, such as `.env` files and build output, do not come back and are deleted with it.

Where your provider and plan support it, you are first asked whether to keep a snapshot of it for the project:

- **Yes** keeps the workspace's disk as the snapshot for this repository, then deletes the workspace. Saving can take a few minutes.
- **No** deletes the workspace without a snapshot.
- Dismissing the question only pauses the workspace.

The next `/cloud` for the repository starts from that snapshot. See [Start from a project snapshot](/docs/workspaces/move-a-session#start-from-a-project-snapshot).

There is one project snapshot per repository. Keeping another replaces the older one, and once you have kept one, the question is to update it, with yes preselected. Before it is saved, the workspace's credentials and its conversations are removed from it. Project snapshots count toward your plan's snapshots and are listed under **Snapshots** in the dashboard, where you can delete them.

## Limits

- At most 25 MiB of new commits and uncommitted changes come back. For more, push the branch from the cloud and pull it locally.
- The cloud checkout must not have merge conflicts, submodules, intent-to-add files, or untracked symlinks or special files. Resolve them in the cloud first.
- The local session must be idle, and in the checkout it was handed off from.
- Processes the cloud agent started do not move.

## Related

- [Move a session](/docs/workspaces/move-a-session)
- [Cloud plugin reference](/docs/reference/cloud-plugin)
- [Lifecycle](/docs/workspaces/lifecycle)

---
title: Lifecycle
description: How a cloud workspace pauses, resumes, keeps its files, and is terminated, from the dashboard, the CLI, and the SDK.
---

A cloud workspace runs while you use it, pauses when it goes idle, resumes when you need it, and is terminated when the work is done. Read this page to control each step and to know what happens to your files.

## Statuses

| Status       | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `pending`    | Compute is being provisioned or resumed. There is no URL yet            |
| `running`    | The provider reports the machine is up. The agent may still be starting |
| `paused`     | Stopped. It can be resumed                                              |
| `terminated` | Deleted for good                                                        |

## Pause, resume and terminate

| Action    | Dashboard (workspace row)    | CLI                                         | SDK                                                    |
| --------- | ---------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Pause     | **Pause** in the details     | `gitterm workspace pause <workspaceId>`     | `client.workspaces.pause(id)`                          |
| Resume    | **Restart** on a paused row  | `gitterm workspace restart <workspaceId>`   | `client.workspaces.restart(id)` or `ensureRunning(id)` |
| Terminate | **Terminate** in the details | `gitterm workspace terminate <workspaceId>` | `client.workspaces.terminate(id)`                      |

`<workspaceId>` is the workspace's id; `gitterm workspace list` prints it. `gitterm workspace stop` is an alias for `pause`.

Pausing stops compute and ends the current usage session. Resuming starts compute again with the files that were kept (see below). `ensureRunning()` resumes a paused workspace and waits until it is running.

## Idle pausing

A running workspace pauses on its own after a period with no activity. Traffic through the workspace's URLs and agent runs in progress count as activity. Gitterm's own status checks do not: reading a run's state, waiting for the workspace to start, and the cloud plugin's status line only observe the workspace, so watching it doesn't stop it from pausing.

| Deployment      | Idle timeout                                                                     |
| --------------- | -------------------------------------------------------------------------------- |
| Managed Gitterm | Set by your plan. See [Plans and billing](/docs/account/plans-and-billing#plans) |
| Self-hosted     | Set by the admin under **Admin → System**. Default 30 minutes                    |

A run that is waiting for your answer counts as a run in progress, so it keeps the workspace awake until you answer, cancel the run, or its deadline passes.

### Keep running when idle

To skip idle pausing, turn on **Keep running when idle** when you create the workspace, or **Keep on when idle** in the row's details later. The row then shows **Always on**. In the SDK, pass `alwaysOn: true` to `workspaces.create()`.

On managed Gitterm this needs a paid plan, and spending limits still pause the workspace. Compute keeps running, and is billed, while the workspace is idle.

## What is kept while paused

Running processes and terminals never survive a pause. Files depend on the provider:

| Provider                            | Files kept across a pause                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E2B, Daytona, Vercel, Boat, exe.dev | Yes                                                                                                                                        |
| Railway, AWS                        | Only with persistent storage                                                                                                               |
| Cloudflare                          | No. The filesystem is rebuilt on restart, and T3 Code loses its sessions, projects and paired devices; use the new pairing link it returns |

The dashboard turns on persistent storage whenever the provider and your plan allow it. In the SDK, pass `persistent: true` to `workspaces.create()`.

On managed Gitterm, a paused workspace is deleted after your plan's retention period. See [Plans and billing](/docs/account/plans-and-billing#plans). Self-hosted deployments keep paused workspaces until you terminate them.

## Terminate

Terminating deletes the workspace at the provider. It cannot be undone, so push any work you want to keep first.

```sh
gitterm workspace terminate <workspaceId> --yes
```

```ts
const { cleanupInBackground } = await client.workspaces.terminate(workspaceId);
```

`cleanupInBackground: true` means the provider finishes tearing down after the call returns.

A terminated workspace can no longer get GitHub, Google or model credentials from Gitterm. Credentials it already received, such as MCP tokens, stay valid until you revoke them where they were issued.

### Terminate automatically

Set a deadline when you create the workspace, so it is removed even if your process crashes:

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  autoTerminateAfterMs: 2 * 60 * 60 * 1000, // 2 hours
});
```

The value can be 1 minute to 30 days. The workspace is terminated at that time whatever its activity, and `workspace.autoTerminateAt` shows the deadline. Idle pausing still applies before then.

## Find old workspaces

**Settings → Workspace history** in the dashboard lists active and terminated workspaces across all your providers. From the CLI:

```sh
gitterm workspace list --status all
```

## Related

- [Cloud workspaces](/docs/workspaces/overview)
- [Plans and billing](/docs/account/plans-and-billing)
- [CLI reference](/docs/reference/cli#workspaces)

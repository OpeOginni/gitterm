---
title: Previews
description: Expose a port from a cloud workspace as a URL, and choose whether it is private to you or public to anyone with the link.
---

Any port in a running cloud workspace can get its own URL. Use it to open the app your agent is working on, or to point a webhook at the workspace. This page covers opening ports and choosing who can reach them.

For previews from a local agent's sandbox, see [Jobs and previews](/docs/sandboxes/jobs-and-previews) instead.

## Private and public ports

| Visibility          | Who can reach the URL                       | Use it for                                        |
| ------------------- | ------------------------------------------- | ------------------------------------------------- |
| `private` (default) | Only you, in a browser signed in to Gitterm | Watching a dev server while the agent works on it |
| `public`            | Anyone with the URL, no Gitterm login       | APIs, webhook receivers, demos                    |

Gitterm removes its own session cookies before a request reaches your app.

## Port URLs

The URL depends on how the deployment routes workspaces:

```text
https://<port>-<workspace>.<domain>      # subdomain routing
https://<domain>/ws/<port>-<workspace>   # path routing
```

`<port>` is the port number, `<workspace>` the workspace's subdomain, and `<domain>` the deployment's domain. Apps that load assets from absolute paths such as `/assets/app.js` work best with subdomain routing.

## Open a port from the dashboard

1. On the running workspace's card, click **Open port**.
2. Enter the **Port** (1 to 65535) and, optionally, a **Name**.
3. Turn on **Public URL** only if the port must be reachable without a Gitterm login.
4. Click **Open port** in the dialog.

You should see the port, such as `:3000`, in the card's port list. Click it to open the URL. Click **Private** or **Public** next to the port to switch its visibility, or remove the port from the same row.

## Open a port from inside the workspace

The `gitterm` CLI is installed in supported workspace images and signs in as the workspace itself. The agent can use it too.

```sh
gitterm ports open 3000 --name app
gitterm ports open 8080 --name api --public
gitterm ports list
gitterm ports visibility 3000 public
gitterm ports close 3000
```

Inside a workspace, the CLI can only see that workspace. All flags are in the [CLI reference](/docs/reference/cli#inside-a-workspace).

## Open a port from code

Inside a workspace, `createGittermWorkspaceClient()` reads the identity Gitterm injects (`WORKSPACE_API_URL`, `WORKSPACE_AUTH_TOKEN`, `WORKSPACE_ID`):

```ts
import { createGittermWorkspaceClient } from "@gitterm/sdk";

const workspace = createGittermWorkspaceClient();
const app = await workspace.ports.open(3000, { name: "app" });
const api = await workspace.ports.open(8080, { name: "api", visibility: "public" });
await workspace.ports.setVisibility(3000, "public");
console.log(app.url, api.url);
```

A port opens as `private` unless you set `visibility`. Opening a port that is already open keeps its current visibility.

> [!WARNING]
> Anyone who has a public URL can reach the port. Switch it back to private, or close it, when you no longer need it.

## Related

- [Connect to a workspace](/docs/workspaces/connect)
- [CLI reference](/docs/reference/cli#inside-a-workspace)
- [SDK reference](/docs/reference/sdk#workspace-client)

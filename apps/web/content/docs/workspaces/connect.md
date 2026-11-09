---
title: Connect to a workspace
nav: Connect
description: Open a running cloud workspace in the browser, the OpenCode phone or desktop app, a local terminal, or the T3 Code apps.
---

Each workspace is a row under **Workspaces** in the dashboard. A running row has one main button, and clicking the row opens its details with the other ways to connect. Which controls you see depends on the agent. Use this page to find the right one for your client, and to understand pairing.

Editor and SSH access are not offered. Connect through the agent's own clients below.

## Before you start

- The workspace is running. A paused workspace's row shows **Restart** instead. See [Lifecycle](/docs/workspaces/lifecycle).
- For the local TUI, desktop app or phone app, your OpenCode is version 2 and up to date.

## OpenCode workspaces

| Control                  | Where   | What it does                                                                                   |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| **Attach TUI**           | Row     | Copies a command. Paste it into your terminal to open the workspace in your local OpenCode TUI |
| **Open in browser**      | Details | Opens the workspace's OpenCode web app in a new tab. With subdomain routing you are signed in  |
| **Connect OpenCode app** | Details | Shows a QR code and a one-time link for the OpenCode phone and desktop apps                    |
| **URL**                  | Details | The workspace's address, for any client that asks for a server URL                             |
| **Server password**      | Details | Copies the server password, for any client that asks for one                                   |
| **Project path**         | Details | Copies the path to paste when OpenCode asks which project to open                              |

### Connect the OpenCode phone app

1. Click the workspace's row, then **Connect OpenCode app**.
2. In the OpenCode app on your phone, add a server and scan the QR code.

You should see the workspace's project and sessions in the app.

If Gitterm is open on the same phone as the app, there is nothing to scan. The pairing link is copied when the dialog opens, so switch to the app and paste it. **Show QR code** is there if you want to scan from another device.

### Connect the OpenCode desktop app

1. Click the workspace's row, then **Connect OpenCode app**. The pairing link is copied when the dialog opens.
2. In the OpenCode desktop app, choose **Connect server** and paste the link.
3. Open the workspace's project. If the app asks for a path, paste the **Project path** from the details.

You should see the workspace's project and sessions in the desktop app.

A code works once and expires after five minutes. For another device, or after it expires, click **New code**.

### Attach the local TUI

1. On the workspace's row, click **Attach TUI**.
2. Paste the copied command into your terminal and press Enter.

You should see the OpenCode TUI, connected to the workspace.

With subdomain routing, the command carries a paired session token instead of the server password. The token lasts up to 30 days, and changing the server password revokes it. Keep the command private.

Without pairing, the command passes the server password in `OPENCODE_PASSWORD`:

```sh
OPENCODE_PASSWORD='<password>' opencode --server https://<workspace-url>
```

`<password>` is the **Server password** from the details, and `<workspace-url>` is the workspace's host name.

### When pairing isn't available

Pairing needs subdomain routing, because OpenCode expects `/auth/connect` at the root of the server URL. With path routing, or on older workspace servers, **Connect OpenCode app** is not shown, **Attach TUI** uses the server password and the web app asks you to sign in. Every connection goes through Gitterm's HTTPS workspace proxy, so you don't need a tunnel.

## OpenCode (TTYD) workspaces

Click **Open terminal** on the row. The OpenCode TUI opens in a terminal in a new browser tab, with no local client.

## T3 Code workspaces

T3 Code signs you in with one-time pairing links, not a password.

| Control             | Where   | What it does                                             |
| ------------------- | ------- | -------------------------------------------------------- |
| **Open in T3**      | Row     | Opens the workspace in the T3 Code desktop app           |
| **Open in browser** | Details | Opens the workspace in the T3 Code web app, in a new tab |
| **Pairing link**    | Details | Copies a one-time link for another device                |
| **New link**        | Details | Makes a new pairing link after the current one was used  |

Each link works once. For another device, click **New link**, or create a link under **Connections** in T3 Code's settings. On Railway and AWS, **New link** isn't available; restart the workspace to get a fresh link.

T3 Code workspaces need subdomain routing. See [Agents](/docs/workspaces/agents#pick-an-agent).

## From code

For OpenCode workspaces, the SDK returns the server URL and password. The API token needs the `workspace:write` scope for `ensureRunning()`, or `workspace:access` for `getRuntimeAccess()`.

```ts
import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient();
const { runtime } = await client.workspaces.ensureRunning("<workspace-id>");
console.log(runtime.url, runtime.password);
```

`ensureRunning()` resumes a paused workspace first. To read the values without waking it, use `getRuntimeAccess()`. Pass them to the official OpenCode SDK for live sessions and events, or use Gitterm's runs API. See the [SDK reference](/docs/reference/sdk#runs).

## Bot workspaces

A Slack or Discord bot works in an ordinary OpenCode workspace named `slack-bot-<repository>` or `discord-bot-<repository>`. Connect to it the same way to see every thread's session. Prompts you send there are not posted back to the chat. See [Slack](/docs/integrations/slack) and [Discord](/docs/integrations/discord).

## Related

- [Previews](/docs/workspaces/previews)
- [Move a session to the cloud](/docs/workspaces/move-a-session)
- [Lifecycle](/docs/workspaces/lifecycle)

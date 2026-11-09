---
title: Connect to a workspace
nav: Connect
description: Open a running cloud workspace in the browser, the OpenCode desktop app, a local terminal, or the T3 Code apps.
---

A running workspace's card in the dashboard has the controls to connect to it. Which ones you see depends on the agent. Use this page to find the right control for your client, and to understand pairing links.

Editor and SSH access are not offered. Connect through the agent's own clients below.

## Before you start

- The workspace is running. A paused workspace's card shows **Restart** instead. See [Lifecycle](/docs/workspaces/lifecycle).
- For the local TUI or desktop app, your OpenCode is version 2 and up to date.

## OpenCode workspaces

A running OpenCode workspace's card has:

| Control                            | What it does                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Attach TUI**                     | Copies a command. Paste it into your terminal to open the workspace in your local OpenCode TUI |
| Globe button                       | Opens the workspace's OpenCode web app. With subdomain routing you are signed in already       |
| **Desktop pairing link**, **Copy** | Copies a one-time link for **Connect server** in the OpenCode desktop app                      |
| Project path                       | Click to copy it. Paste it when OpenCode asks which project to open                            |
| Key row, **Copy**                  | Copies the server password, for any client that asks for one                                   |

### Open in the OpenCode desktop app

1. On the workspace card, click **Copy** next to **Desktop pairing link**.
2. In the OpenCode desktop app, choose **Connect server** and paste the link.
3. Open the workspace's project. If the app asks for a path, paste the project path from the card.

You should see the workspace's project and sessions in the desktop app. A pairing link works once and expires after five minutes, so copy a new one for each device.

### Attach the local TUI

1. On the workspace card, click **Attach TUI**.
2. Paste the copied command into your terminal and press Enter.

You should see the OpenCode TUI, connected to the workspace.

With subdomain routing, the command carries a paired session token instead of the server password. The token lasts up to 30 days, and changing the server password revokes it. Keep the command private.

Without pairing, the command passes the server password in `OPENCODE_PASSWORD`:

```sh
OPENCODE_PASSWORD='<password>' opencode --server https://<workspace-url>
```

`<password>` is the server password from the card, and `<workspace-url>` is the workspace's host name.

### When pairing isn't available

Pairing needs subdomain routing, because OpenCode expects `/auth/connect` at the root of the server URL. With path routing, or on older workspace servers, **Attach TUI** uses the server password and the web app asks you to sign in. Every connection goes through Gitterm's HTTPS workspace proxy, so you don't need a tunnel.

## OpenCode (TTYD) workspaces

Click **Open workspace**. The OpenCode TUI opens in a terminal in your browser, with no local client.

## T3 Code workspaces

T3 Code signs you in with one-time pairing links, not a password. A running T3 Code workspace's card has:

| Control                    | What it does                                            |
| -------------------------- | ------------------------------------------------------- |
| **Open in T3**             | Opens the workspace in the T3 Code desktop app          |
| Globe button               | Opens the workspace in the T3 Code web app              |
| **Pairing link**, **Copy** | Copies a one-time link for another device               |
| **New link**               | Makes a new pairing link after the current one was used |

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

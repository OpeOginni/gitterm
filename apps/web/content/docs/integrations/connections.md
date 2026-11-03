---
title: Connections
description: Attach GitHub, Google Cloud, MCP servers and Executor to cloud workspaces, and reference connections by id, name, or integration key.
---

A connection gives a cloud workspace access to something outside it: your GitHub repositories, a Google Cloud service account, or an MCP server's tools. Read this page to set up each kind and attach it to workspaces, bots and `/cloud`.

## How connections work

- The deployment's admin turns integrations on under **Admin → Integrations**. You only see the ones they turned on.
- A connection is **personal** (you create it under **Integrations** in the dashboard) or **shared** (the admin provides it for everyone). You attach both the same way.
- You attach connections when you create a workspace. Changing a connection affects new workspaces only.
- GitHub and Google credentials are issued inside the workspace. They are never returned to the dashboard, the SDK, or your code.

| Integration  | Key        | Per workspace |
| ------------ | ---------- | ------------- |
| GitHub       | `github`   | At most one   |
| Google Cloud | `google`   | At most one   |
| MCP server   | `mcp`      | Any number    |
| Executor     | `executor` | Any number    |

## GitHub

The admin picks one mode for the whole deployment:

| Mode         | How you get it                                                                                                              | What the workspace gets                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GitHub App   | Under **Integrations → GitHub**, click **Connect** (or **Add account**) and install the App on your account or organization | Tokens scoped to the installation's repositories. They expire after an hour and are renewed while the workspace runs |
| Shared token | The admin adds one fine-grained token. It appears as the shared connection `github:shared`                                  | Access as the GitHub account the admin chose                                                                         |

With either mode, `git` and `gh` work inside the workspace without `gh auth login`, and you don't sign in to Gitterm with GitHub.

Without a GitHub connection you can use public repositories, or pass your own token from the SDK:

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/private-repo",
  repositoryCredentials: { token: process.env.GITHUB_TOKEN! }, // username defaults to x-access-token
});
```

Gitterm doesn't save an inline token, but the token stays on the workspace machine and is not renewed. Use a GitHub connection or `repositoryCredentials`, not both.

## Google Cloud

A Google Cloud connection gives `gcloud` and Google client libraries access without a service-account key file. The workspace exchanges a five-minute Gitterm identity token through Google Workload Identity Federation and acts as one service account you choose.

1. In Google Cloud, create a dedicated service account. Grant it only the roles the agent needs.
2. In the dashboard, open **Integrations → Google Cloud** and click **Add identity**. Fill in **Display name**, **Google project ID**, **Google project number** and **Service account**.
3. Run the `gcloud` commands the form shows to create the workload identity pool and provider. They change your Google IAM settings, not Gitterm. Then click **Save identity**.
4. You should see the new identity's card. Run the command it shows under **Allow this identity to use the service account**. It lets only this Gitterm identity impersonate the service account.
5. When you create a workspace, open **Add integrations** and pick the identity under **Google Cloud identity**.

In the workspace, `gcloud` and Google client libraries pick up the credentials through Application Default Credentials, with no sign-in.

The service account's IAM roles are the real limit on what the workspace can do. Removing the connection stops new tokens at once; tokens already issued expire within their short lifetime.

## MCP servers and Executor

MCP connections give an OpenCode workspace extra tools. OpenCode connects to the server directly from the workspace; Gitterm doesn't relay tool traffic. T3 Code workspaces can't use MCP connections yet.

1. Under **Integrations**, click **Add MCP server**.
2. Enter a **Connection name** and the **MCP endpoint**: a public HTTPS URL that speaks Streamable HTTP.
3. Under **Authentication**, choose **None**, **Bearer token**, or **Headers** (a JSON object of headers).
4. Click **Save and test**. The test lists the server's tools without calling any. You should see **Test passed**; a connection that hasn't passed can't be attached.
5. When you create an OpenCode workspace, open **Add integrations** and select the connection under **MCP servers and Executor**.
6. In the workspace, run `opencode mcp list` or `/mcps`. You should see the server listed.

For **Executor**, click **Connect Executor**. Paste your Executor organization's MCP URL, choose **Bearer token**, and paste an organization token from Executor. Check what that token can reach: it isn't necessarily limited to the tools you picked in Executor.

Limits:

- 50 saved MCP and Executor connections per user.
- 32 connections per workspace in total.
- OAuth-only servers and private endpoints aren't supported through Gitterm. Configure those in OpenCode directly.

> [!WARNING]
> MCP credentials become environment variables in the workspace, so the agent can read them. Removing a connection, or the admin turning the integration off, doesn't revoke credentials a workspace already received. Revoke them at the provider.

## Reference a connection

Anywhere you pass `connections` (the SDK, the options of the [cloud handoff plugin](/docs/reference/cloud-handoff#options), bot settings), each entry can be one of:

| Reference       | Example                             | Matches                                                                                                                                                  |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration key | `"github"`                          | For `github`: the connection that covers the repository's owner, or the shared one. For `google`, `mcp` and `executor`: the only connection of that kind |
| Name            | `"Linear"`                          | The connection with that name, as shown under **Integrations**. Case-insensitive                                                                         |
| Id              | `"3f7d0c2e-…"` or `"github:shared"` | Exactly that connection                                                                                                                                  |

A key that matches more than one connection, or a name two connections share, is rejected. Use the id, or rename one of them.

```ts
await client.workspaces.create({
  repo: "https://github.com/acme/product",
  connections: ["github", "Linear", "Production"],
});

// See what a list would attach, without creating anything:
const resolved = await client.integrations.connections.resolve(["github", "Linear"], {
  repo: "https://github.com/acme/product",
});
```

`client.integrations.connections.list()` lists what you can attach. Creating connections from the SDK needs a token with the `integrations:write` scope. See the [SDK reference](/docs/reference/sdk#integrations).

## Related

- [Self-hosting security](/docs/self-hosting/security)
- [Agents](/docs/workspaces/agents)
- [Slack](/docs/integrations/slack) and [Discord](/docs/integrations/discord)

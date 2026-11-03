---
title: Quickstart
description: Run your first command in a remote sandbox, or start a cloud workspace.
---

This page has two short paths. Path 1 gives your local OpenCode agent a remote sandbox. Path 2 runs an agent in a cloud workspace. They are independent; pick the one you need. For how they differ, see [Concepts](/docs/concepts).

## Path 1: run a command in a sandbox

Your agent and your files stay local. The agent runs one command in a remote sandbox and reads the result.

### Before you start

- OpenCode installed, open in a Git checkout.
- An E2B API key. Any supported provider works; see [Providers](/docs/sandboxes/providers). To use your Gitterm plan instead of your own key, see [Managed accounts](/docs/sandboxes/setup#managed-accounts).

### Steps

1. Install the sandbox tools plugin:

   ```sh
   opencode plugin add @gitterm/opencode-sandbox-tools
   ```

2. Put your key in an environment variable, in the shell you start OpenCode from. Replace `<your-e2b-key>` with your key:

   ```sh
   export E2B_API_KEY=<your-e2b-key>
   ```

3. In your OpenCode config, replace the `@gitterm/opencode-sandbox-tools` entry with this object. OpenCode replaces `{env:E2B_API_KEY}` with the variable's value when it loads the config, so the key never sits in the file.

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       {
         "package": "@gitterm/opencode-sandbox-tools",
         "options": {
           "account": "e2b",
           "accounts": {
             "e2b": { "mode": "direct", "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
           },
         },
       },
     ],
   }
   ```

4. Restart OpenCode and ask the agent:

   ```text
   Create a sandbox, sync this checkout to it, and run npm test there.
   ```

   OpenCode asks you to approve creating the sandbox, uploading the checkout, and running the command. The upload prompt lists the files that will be uploaded. The sandbox appears under **Sandboxes** in OpenCode's right sidebar.

   You should see a job result such as `Job job_… in sandbox …: succeeded, exit 0`, followed by the test output.

5. Ask the agent to destroy the sandbox.

   You should see `Sandbox <id> is terminated (confirmed with the provider).`

> [!WARNING]
> Your E2B account is billed while the sandbox exists. E2B deletes it at the end of its lifetime (30 minutes by default), but destroying it yourself stops charges sooner.

Next: [Sandbox tools](/docs/sandboxes/tools) and [Jobs and previews](/docs/sandboxes/jobs-and-previews).

## Path 2: start a cloud workspace

A cloud workspace runs the agent itself in the cloud.

### Before you start

- A Gitterm account, with your model credentials and repository access set up in the dashboard.

### Steps

1. Sign in to the dashboard and click **New workspace**.
2. Pick a GitHub repository and branch. Then choose the **Agent** (OpenCode, OpenCode (TTYD), or T3 Code), **Cloud**, **Region**, and **Machine**.
3. Click **Create workspace**.

   You should see the new workspace in your dashboard. When it is running, open it in the browser or connect a local client; see [Connect](/docs/workspaces/connect).

> [!WARNING]
> A cloud workspace can be charged while it runs. Pause or terminate it in Gitterm when you are finished.

### Or move a local OpenCode session

To continue a session you already started, install `@gitterm/opencode-cloud-handoff` and run `/cloud` in OpenCode. It moves the conversation and checkout into a new cloud workspace, one-way. See [Move a session](/docs/workspaces/move-a-session) for the steps.

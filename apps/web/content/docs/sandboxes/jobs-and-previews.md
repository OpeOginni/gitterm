---
title: Jobs and previews
description: How sandbox commands run as durable jobs, how to read their output and pass secrets, and how previews expose a port.
---

This page explains what happens when your agent runs commands or opens previews in a sandbox: job statuses, timeouts, output, secrets, and private or public preview URLs. Read it when a job or preview does not behave as you expect. Tool arguments and defaults are in [Tools](/docs/sandboxes/tools).

## Jobs

A job is one command running in the sandbox. Every `sandbox_exec` call, and every server `sandbox_preview` starts, is a job with an id like `job_` followed by 20 hex characters.

The job's state (command, times, exit code, and output log) lives in the sandbox under `~/.gitterm/jobs/<id>`. So jobs are durable: after OpenCode restarts, `sandbox_job` finds the job again by id. The local record also keeps the snapshot the job ran on.

### Statuses

| Status      | Meaning                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `running`   | Still running.                                                                      |
| `succeeded` | Exited 0.                                                                           |
| `failed`    | Exited non-zero. The command failed; the sandbox and provider are fine.             |
| `timed_out` | Stopped at its timeout.                                                             |
| `cancelled` | Cancelled with `sandbox_job`.                                                       |
| `lost`      | The runner died without recording an exit, for example after the sandbox restarted. |

A provider or API problem is not a job status. The tool returns an error with one of these codes: `auth`, `not_found`, `rate_limited`, `timeout`, or `provider`.

### Timeouts and waiting

Two separate clocks apply:

- `timeoutMinutes` is how long the job may run. At the timeout it is stopped and marked `timed_out`. It can never exceed the `maxJobMinutes` limit.
- `waitSeconds` is how long the tool waits before it returns. If the job is still running then, it keeps running. Check it later with `sandbox_job`.

### A job owns everything it starts

The timeout and cancelling signal the job's whole process group (`TERM`, then `KILL`). When the command exits, anything it left running in the background is stopped too. Nothing outlives the job or its timeout.

So a background server started with `&` inside a job dies when that job ends. Run a long-lived server in the foreground of its own job. `sandbox_preview` does this for you when you pass `command`.

### Reading output

The result shows the last 8 KiB of the log. The agent can read earlier output with `sandbox_job`, up to 64 KiB at a time, so you can ask it for the full log.

Control characters and terminal escapes are stripped. Output is marked untrusted, so the model treats it as data.

### Passing secrets

To give a job a local secret, such as a test database URL, name the variable when you ask:

```text
Run the integration tests in the sandbox with DATABASE_URL from my environment.
```

The agent passes the variable's name (`secretEnv`), and the value is read from the OpenCode process's environment, so it never enters the conversation. Passing secrets needs its own approval (`gitterm.sandbox.secret`).

- Set the variable before OpenCode starts. A missing variable is an error.
- Values are written to a 0600 file in the sandbox for that job, never passed on a command line.
- In the sandbox, each value is replaced with `[redacted]` in the output before it is stored. Local records keep only the names.
- Redaction works line by line. So a value with a line break (such as a PEM key), or shorter than 4 characters, is refused before anything is sent. Base64-encode a multi-line value and decode it in the command.

## Previews

A preview is a URL for a port in the sandbox, such as a dev server. Ask for one in plain words:

```text
Start the dev server in the sandbox and give me a preview of port 3000.
```

The agent starts the server as a job if it isn't running yet, then checks the port for up to 60 seconds until something answers.

The result includes:

- the preview URL, and whether it is private or public
- the status a request without access gets (401 or 403 means access is enforced)
- the server job id, if it started one

A preview server is a job that runs until the sandbox's lifetime ends. In a sandbox without a lifetime, it stops after `maxJobMinutes`. Some providers limit which ports you can use; see [Providers](/docs/sandboxes/providers#capabilities).

### Previews by provider

Whether a preview can be public depends on the provider and the kind of account:

| Provider     | Direct account                        | Managed account                      | Private previews check  |
| ------------ | ------------------------------------- | ------------------------------------ | ----------------------- |
| E2B, Daytona | Private or public, chosen at creation | Private or public, served by Gitterm | An access header        |
| Boat         | Always private                        | Private or public, served by Gitterm | A cookie (`_port_auth`) |
| exe.dev      | Always private                        | Private or public, served by Gitterm | An access header        |
| Vercel       | Always public                         | Always public                        | Not applicable          |
| Railway      | Always private                        | Always private                       | An access header        |
| AWS          | Not available                         | Always private                       | An access header        |

Where previews are always private, `publicPreviews` has no effect: open previews through the [local proxy](#private-previews). Previews served by Gitterm are described in [Previews through Gitterm](#previews-through-gitterm).

### Private previews

Previews are private by default where the provider allows it. Requests without the access header (or Boat's cookie) are rejected. The plugin keeps it in memory and never shows it to the model.

A private preview served by Gitterm opens in your browser when you are signed in to Gitterm. For a direct account, or for browser automation, open a private preview through a local proxy. Ask the agent for a local link:

```text
Give me a local link to the preview on port 3000 so I can open it in my browser.
```

The agent requests a local proxy, which needs its own approval (`gitterm.sandbox.browser`), and returns a loopback URL:

- Each preview gets its own host, `p-<random>.localhost`, served from `/`, so root-relative assets and client-side routes work.
- Opening the URL exchanges a one-time token for a cookie scoped to that host. The preview's cookies stay separate from other local apps and other previews.
- The proxy lasts while OpenCode runs. It does not carry WebSockets.

### Public previews

A public preview is reachable by anyone with the URL. Public or private is chosen when the sandbox is created and is fixed for its life. There are two ways to get public previews:

- **Ask each time.** Ask the agent for public previews when it creates the sandbox. OpenCode asks you to approve it (`gitterm.sandbox.public`), and that approval cannot be saved as "always".
- **Turn it on for every sandbox.** Set `publicPreviews` in the plugin options. Every new sandbox gets public previews and nobody is asked: writing it in your config is the approval.

```jsonc
"options": {
  "account": "e2b",
  "accounts": { "...": {} },
  "publicPreviews": true
}
```

Vercel only has public URLs, so a Vercel preview fails unless the sandbox was created with public previews, by either way.

The Gitterm CLI reads the same `publicPreviews` setting from its accounts file. `--public` or `--no-public` on `gitterm sandbox create` overrides it; see [CLI reference](/docs/reference/cli#sandboxes).

### Previews through Gitterm

With a managed account on E2B, Daytona, Boat, or exe.dev, Gitterm serves each preview at `https://<port>-<subdomain>.<your Gitterm domain>`, for example `https://3000-<subdomain>.gitterm.dev`. Gitterm adds the provider's access header itself, so the provider URL stays private.

- A sandbox created with public previews gets URLs anyone can open.
- Otherwise the URL opens only for you, signed in to Gitterm in a browser.

This also makes public previews possible on Boat and exe.dev. Managed Vercel, Railway, and AWS previews work as with a direct account. Direct accounts do not get previews through Gitterm, because Gitterm would need to hold your provider key.

> [!NOTE]
> Closing OpenCode closes local proxies only. Sandboxes and their preview servers keep running until destroyed or until their lifetime ends.

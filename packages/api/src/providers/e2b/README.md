# E2B Provider

Runs GitTerm workspaces as E2B sandboxes.

E2B is configured from the GitTerm admin panel and the [E2B dashboard](https://e2b.dev/).

## Config

Open the admin panel and set these values:

| Field            | Required | Notes                                |
| ---------------- | -------- | ------------------------------------ |
| `API Key`        | Yes      | E2B API key                          |
| `Webhook Secret` | Yes      | Shared secret for webhook signatures |

## Webhook

In E2B, create or update a sandbox lifecycle webhook:

- Via proxy: `https://<your-base-domain>/listener/trpc/e2b.handleWebhook`
- Via listener: `https://<listener-base-url>/trpc/e2b.handleWebhook`
- Signature secret: use the same value you saved as `Webhook Secret` in GitTerm

Subscribe to at least these events:

- `sandbox.lifecycle.paused`
- `sandbox.lifecycle.resumed`
- `sandbox.lifecycle.killed`

## Templates

By default, workspaces start from E2B's `base` template (2 vCPU, 512 MB) and install the agent
with the image's `setupCommands`. GitTerm publishes no templates.

E2B fixes a sandbox's size per template, so larger machines and faster starts need your own
templates. Build them into your account with `E2B_API_KEY=... bun run e2b:build` in
`packages/api` (`--agent opencode|t3code|sandbox` for one). It builds each agent at every size
(`<name>`, `<name>-sm`, `<name>-lg`). Then, in the admin panel:

1. Set the image's E2B `templateId` to your template. The workspace starts from it and skips
   the install.
2. Add a machine profile for each size, with `{"templateSuffix": "-sm"}` or `"-lg"` as its
   provider options and the template's vCPUs and memory.

## Reference

Field definitions live in `packages/schema/src/provider-registry.ts`.

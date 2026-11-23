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

E2B fixes a sandbox's size per template, so every machine size is its own template
(`<name>`, `<name>-sm`, `<name>-lg`). The **Release GitTerm** action builds them with the
`runtimes` or `both` target, including the `gitterm-sandbox` templates. Published templates
are public so self-hosted installs can start them, and the seed uses them by default.

To use your own instead, run `E2B_API_KEY=... bun run e2b:build` in `packages/api`
(`--agent opencode|t3code|sandbox` for one; `E2B_TEMPLATE_OWNER` for `--verify` and
`--promote`), then set the image's E2B `templateId` in the admin panel. The seed keeps a template
you set. With no `templateId`, a workspace starts from E2B's `base` template and installs the
agent with the image's `setupCommands`.

## Reference

Field definitions live in `packages/schema/src/provider-registry.ts`.

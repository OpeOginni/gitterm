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

## Reference

Field definitions live in `packages/schema/src/provider-registry.ts`.

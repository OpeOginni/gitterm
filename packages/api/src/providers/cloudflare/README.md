# Cloudflare Sandbox Provider (WIP)

Runs GitTerm workspaces on [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) through a Cloudflare Worker.

This provider is a work in progress.

## Deploy the worker

The worker lives at `packages/api/src/providers/cloudflare/agent-worker/src/index.ts`. Deploy it with Wrangler:

```bash
cd packages/api
bun run wrangler:deploy
```

## Config

Open the admin panel and set these values:

| Field             | Required | Notes                                       |
| ----------------- | -------- | ------------------------------------------- |
| `Worker URL`      | Yes      | URL of the deployed agent worker            |
| `Callback Secret` | Yes      | Shared secret used to authenticate callbacks |

## Reference

Field definitions live in `packages/schema/src/provider-registry.ts`.

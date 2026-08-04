# Ascii Box Provider

Runs GitTerm workspaces on persistent Ascii Box Linux VMs.

## Config

Configure the following value in the GitTerm admin panel:

| Field         | Required | Notes                                               |
| ------------- | -------- | --------------------------------------------------- |
| `Box API Key` | Yes      | Service API key created in the Ascii Box dashboard. |

## Images

Each agent image enabled for Ascii needs `providerMetadata.ascii`:

```json
{
  "ascii": {
    "size": "default"
  }
}
```

Available sizes are `small`, `default`, and `large`. Ascii Box includes Ubuntu, Node.js, Bun, Git, Docker, and common development tooling.

## Access

GitTerm creates private Ascii-hosted URLs and keeps their `_token` values in server-side route access. Users see only GitTerm workspace URLs.

Editor access uses each users saved SSH public key, which GitTerm authorizes on the Box when they request a connection.

## Reference

- [Ascii Box documentation](https://docs.ascii.dev/box/quickstart)
- Provider fields: `packages/schema/src/provider-registry.ts`

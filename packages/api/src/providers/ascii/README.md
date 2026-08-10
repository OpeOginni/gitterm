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
    "size": "default",
    "setupCommands": ["npm install -g opencode-ai --no-audit --fund=false"]
  }
}
```

Available sizes are `small`, `default`, and `large`. The seeded OpenCode Server and T3Code agents run their `setupCommands` after the Box is ready and before GitTerm starts the agent server. This is intentionally blocking: the workspace is not marked ready until its selected agent is installed.

Ascii also offers a per-Box `setup-file`, but it runs in the background and does not delay readiness. GitTerm uses its API command flow instead because agent installation must finish before the server starts. Setup commands may run for up to 600 seconds, which accommodates first-time npm installs.

Ascii Box uses curated VM images, not user-built Docker images. Docker may be available inside a Box on supported images, but Ascii does not build Dockerfiles or execute Dockerfile `RUN`/`COPY` steps as part of Box creation. For repeated heavy setup, use an Ascii template Box snapshot rather than relying on Docker builds.

## Access

GitTerm creates private Ascii-hosted URLs and keeps their `_token` values in server-side route access. Users see only GitTerm workspace URLs.

Editor access uses each users saved SSH public key, which GitTerm authorizes on the Box when they request a connection.

## Reference

- [Ascii Box documentation](https://docs.ascii.dev/box/quickstart)
- Provider fields: `packages/schema/src/provider-registry.ts`

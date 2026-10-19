# Boat Provider (provider key `boat`)

Runs GitTerm workspaces on persistent [Boat](https://boat.dev) Linux VMs.

## Config

Configure the following value in the GitTerm admin panel:

| Field          | Required | Notes                                          |
| -------------- | -------- | ---------------------------------------------- |
| `Boat API key` | Yes      | Service API key created in the Boat dashboard. |

## Images

Each agent image enabled for Boat needs `providerMetadata.boat`:

```json
{
  "boat": {
    "size": "default",
    "setupCommands": ["npm install -g @opencode/cli@2 --no-audit --fund=false"]
  }
}
```

Available sizes are `small`, `default`, and `large`. The seeded OpenCode Server and T3Code agents run their `setupCommands` after the Box is ready and before GitTerm starts the agent server. This is intentionally blocking: the workspace is not marked ready until its selected agent is installed.

Boat also offers a per-Box `setup-file`, but it runs in the background and does not delay readiness. GitTerm uses its API command flow instead because agent installation must finish before the server starts. Setup commands may run for up to 600 seconds, which accommodates first-time npm installs.

Boat uses curated VM images, not user-built Docker images. Docker may be available inside a Box on supported images, but Boat does not build Dockerfiles or execute Dockerfile `RUN`/`COPY` steps as part of Box creation. For repeated heavy setup, use a Boat template Box snapshot rather than relying on Docker builds.

## Access

GitTerm creates private Boat-hosted URLs and keeps their `_token` values in server-side route access. Users see only GitTerm workspace URLs.

Editor access uses each users saved SSH public key, which GitTerm authorizes on the Box when they request a connection.

## Reference

- [Boat documentation](https://docs.boat.dev)
- Provider fields: `packages/schema/src/provider-registry.ts`

## Upgrading existing deployments

Apply migration `0043_boat_provider_branding` **before running the seed**. It renames existing provider keys and image metadata in place, preserving provider IDs, credentials, workspace links, and billing history. Reseeding alone does not migrate existing credentials.

Update registered webhook URLs from `ascii.handleWebhook` to `boat.handleWebhook` and use `boat` in API/SDK configurations. The old provider key is no longer accepted.

Deploy the proxy alongside the API to use the renamed `X-GitTerm-Boat-Token` routing header.

The upstream SDK (`@asciidev/box-sdk`), API hostname, and `X-Ascii-*` headers retain their upstream names; these are not GitTerm provider aliases.

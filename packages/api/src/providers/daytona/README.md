# Daytona Provider

Runs GitTerm workspaces as Daytona sandboxes.

Daytona is configured from the GitTerm admin panel.

## Config

Open the admin panel and set these values:

| Field                  | Required | Notes               |
| ---------------------- | -------- | ------------------- |
| `API Key`              | Yes      | Daytona API key     |
| `Default Target Region`| Yes      | `us` or `eu`        |

## Webhook

Daytona does not require an inbound webhook for the current implementation.

## Reference

Field definitions live in `packages/schema/src/provider-registry.ts`.

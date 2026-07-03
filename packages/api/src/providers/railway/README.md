# Railway Provider

Runs GitTerm workspaces as Railway services inside a project and environment you control.

## Config

Open the admin panel and set these values:

| Field                    | Required | Notes                                                  |
| ------------------------ | -------- | ------------------------------------------------------ |
| `API URL`                | No       | Defaults to `https://backboard.railway.app/graphql/v2` |
| `API Token`              | Yes      | Railway account or team token                          |
| `Project ID`             | Yes      | Project that hosts the workspaces                      |
| `Environment ID`         | Yes      | Environment inside that project                        |
| `Default Region`         | No       | Pick a Railway metal region                            |
| `Public Railway Domains` | No       | Generate public Railway domains for workspaces         |

## Webhook

Add a Railway webhook pointing at the GitTerm listener:

- Via proxy: `https://<your-base-domain>/listener/trpc/railway.handleWebhook`
- Via listener: `https://<listener-base-url>/trpc/railway.handleWebhook`

Subscribe to these events:

- `Deployment Failed`
- `Deployment Deploying`
- `Deployment Slept`
- `Deployment Deployed`

## Reference

Field definitions live in `packages/schema/src/provider-registry.ts`.

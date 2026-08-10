# Vercel Sandbox Provider

Runs GitTerm workspaces in persistent Vercel Sandbox microVMs.

## Config

Configure the following values in the GitTerm admin panel:

| Field        | Required | Notes                                                             |
| ------------ | -------- | ----------------------------------------------------------------- |
| `API Token`  | Yes      | Vercel access token with access to the selected team and project. |
| `Team ID`    | Yes      | Vercel team ID.                                                   |
| `Project ID` | Yes      | Vercel project ID used for Sandbox operations.                    |

## Images

Each agent image enabled for Vercel needs `providerMetadata.vercel`. Custom OCI images stored in Vercel Container Registry are supported when a deployment needs a fixed filesystem or faster cold starts:

```json
{
  "vercel": {
    "image": "my-vcr-repository:latest",
    "vcpus": 2
  }
}
```

### Managed Runtime Default

The seeded OpenCode Server and T3Code agents use Vercel managed Node runtimes and install the selected agent when a sandbox starts. We deliberately use this as the default instead of requiring every GitTerm deployment to build, publish, maintain, and grant access to its own VCR images.

This makes cold starts slower because dependencies must be installed before the agent server can start. It is the better default user experience: configuring Vercel only requires the API token, team ID, and project ID, while GitTerm maintains the install commands and agent versions. Persistent sandbox resumes reuse the installed runtime. Deployments that prioritize startup latency can still opt into a custom VCR image.

Vercel public preview URLs are routed through GitTerm. Vercel Sandbox does not provide SSH editor access.

> [!WARNING]
> Vercel Sandbox preview URLs are public by default. GitTerm only presents its own workspace URLs and does not display the underlying `*.vercel.run` URL, but anyone who obtains that URL can access the exposed port. Do not use Vercel Sandbox for private previews or services that lack their own authentication.

## Reference

- [Vercel Sandbox documentation](https://vercel.com/docs/sandbox)
- Provider fields: `packages/schema/src/provider-registry.ts`

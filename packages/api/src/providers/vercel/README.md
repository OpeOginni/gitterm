# Vercel Sandbox Provider

Runs GitTerm workspaces in persistent Vercel Sandbox microVMs.

## Config

Configure the following values in the GitTerm admin panel:

| Field | Required | Notes |
| --- | --- | --- |
| `API Token` | Yes | Vercel access token with access to the selected team and project. |
| `Team ID` | Yes | Vercel team ID. |
| `Project ID` | Yes | Vercel project ID used for Sandbox operations. |

## Images

Each agent image enabled for Vercel needs `providerMetadata.vercel`. Use an OCI image stored in Vercel Container Registry that includes the coding agent:

```json
{
  "vercel": {
    "image": "my-vcr-repository:latest",
    "vcpus": 2
  }
}
```

Vercel public preview URLs are routed through GitTerm. Vercel Sandbox does not provide SSH editor access.

> [!WARNING]
> Vercel Sandbox preview URLs are public by default. GitTerm only presents its own workspace URLs and does not display the underlying `*.vercel.run` URL, but anyone who obtains that URL can access the exposed port. Do not use Vercel Sandbox for private previews or services that lack their own authentication.

## Reference

- [Vercel Sandbox documentation](https://vercel.com/docs/sandbox)
- Provider fields: `packages/schema/src/provider-registry.ts`

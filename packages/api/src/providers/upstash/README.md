# Upstash Box Provider

Runs GitTerm workspaces in durable Upstash Box containers.

## Config

Configure the following value in the GitTerm admin panel:

| Field         | Required | Notes                                   |
| ------------- | -------- | --------------------------------------- |
| `Box API Key` | Yes      | API key created in the Upstash Console. |

## Images

Each agent image enabled for Upstash needs `providerMetadata.upstash`:

```json
{
  "upstash": {
    "runtime": "node",
    "size": "small"
  }
}
```

Supported runtimes are `node`, `python`, `golang`, `ruby`, and `rust`, with `-alpine` variants. Box sizes are `small`, `medium`, and `large`.

## Access

GitTerm creates bearer-token-protected Box URLs and keeps their tokens in server-side route access. GitTerm presents only its own workspace URLs.

Upstash Box SSH is intentionally unsupported: Upstash authenticates SSH with the account-wide Box API key, which must never be shared with a workspace user.

## Reference

- [Upstash Box documentation](https://upstash.com/docs/box)
- Provider fields: `packages/schema/src/provider-registry.ts`

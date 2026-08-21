# External PR Review

Create a disposable before/after review for a public GitHub pull request without writing to that repository.

```sh
bun install
export GITTERM_API_TOKEN=gt_...
export TARGET_REPOSITORY=anomalyco/opencode
export TARGET_PR=123
bun record-external-pr.ts
```

The SDK uses `https://api.gitterm.dev` by default. Set `GITTERM_SERVER_URL` to override it.

The script writes `review.md` and `review.json` to `artifacts/external-pr-review` and terminates both workspaces when it finishes.

## Choosing the model

By default the runs use the model credentials saved in your Gitterm dashboard. To pick a model
and bring your own API key instead, set both of these:

```sh
export GITTERM_MODEL=anthropic/claude-sonnet-4-20250514
export GITTERM_MODEL_API_KEY=sk-ant-...
```

The key is injected into the two disposable workspaces and never stored in Gitterm. It must be
an API-key provider (the part before the `/`), such as `anthropic` or `openai`.

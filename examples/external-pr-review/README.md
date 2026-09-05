# External PR Review

Create a disposable before/after review for a public GitHub pull request without writing to that repository.

```sh
bun install
bun run --cwd ../../packages/sdk build
export GITTERM_API_TOKEN=gt_...
export R2_ACCOUNT_ID=...
export R2_ACCESS_KEY_ID=...
export R2_BUCKET=external-pr-reviews
export R2_SECRET_ACCESS_KEY=...
# Optional; when set, uploads return public HTTPS URLs.
export R2_PUBLIC_URL=https://assets.example.com
export TARGET_REPOSITORY=anomalyco/opencode
export TARGET_PR=123
bun record-external-pr.ts
```

This in-repository example uses the local SDK build. When copying it outside the repository,
replace the workspace dependency with `@gitterm/sdk@^0.2.0` after that version is published.

The SDK uses `https://api.gitterm.dev` by default. Set `GITTERM_SERVER_URL` to override it.

The script prints the before/after reports (including the uploaded capture URLs) to the console and terminates both workspaces when it finishes.

## Choosing the model

By default the runs use the model credentials saved in your Gitterm dashboard. To pick a model
and bring your own API key instead, set both of these:

```sh
export GITTERM_MODEL=anthropic/claude-sonnet-4-20250514
export GITTERM_MODEL_API_KEY=sk-ant-...
```

The key is injected into the two disposable workspaces and never stored in Gitterm. It must be
an API-key provider (the part before the `/`), such as `anthropic` or `openai`.

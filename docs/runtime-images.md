# Runtime image versions

Daytona and AWS workspaces run on runtime images (`opeoginni/gitterm-opencode-server`,
`gitterm-opencode`, `gitterm-t3code-server`, `gitterm-opencode-server-aws` on Docker Hub),
versioned separately from the platform (`v1.x` server, web, proxy). Other providers, E2B
included, start from a plain base and install the agent when the workspace is created. GitTerm
publishes no E2B templates or snapshots: an admin can set their own prebuilt per image (see
[sandbox-standard.md](sandbox-standard.md#prebuilt-snapshots)).

## Run a release

Open **Actions → Release GitTerm → Run workflow** on the default branch.

| Target     | What it does                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `both`     | Builds and checks runtimes, promotes them, then builds and releases the platform from the same commit. |
| `runtimes` | Publishes runtimes without bumping the platform version.                                               |
| `platform` | Checks that the runtime line is available, then builds and releases the platform.                      |

Runtime publishing needs `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` in GitHub Actions. The
repository's GitHub token publishes the platform images and release.

The runtime build resolves OpenCode and T3 Code once. Publish the
version of `@gitterm/cli` in `packages/cli/package.json` to npm before running a runtime release.
The workflow builds release candidates and checks them before moving the runtime aliases.
For the platform, it starts the self-hosted Compose stack and checks login and session
cookies before it publishes the versioned images and tags the source commit. There is
no release commit. **Publish Bot Image** remains a separate action.

If a release fails, start a new workflow run rather than rerunning an old one. If the Git
tag was pushed but GitHub failed to create its release page, create the GitHub release
from the existing tag instead of bumping the version again.

## Tags

Each runtime release uses three tags:

| Tag           | Example  | Moves?              | Used by                                           |
| ------------- | -------- | ------------------- | ------------------------------------------------- |
| `latest`      | `latest` | On promotion        | Installs older than the runtime line (bare names) |
| Runtime major | `1`      | On promotion        | The seed, so every current install                |
| Exact build   | `1.57.1` | Not by the workflow | Rollbacks and debugging                           |

The workflow creates the exact tag from `<major>.<workflow run number>.<attempt>`.

The major lives in one place: `RUNTIME_IMAGE_MAJOR` in `packages/db/src/runtime-image.ts`. The
seed writes it into the image catalog (`opeoginni/gitterm-opencode-server:1`,
`brightoginni123/gitterm-opencode-server:1`), and the seed runs on every server start, so a
platform upgrade moves an install to the line it ships with.

## When to bump the major

Almost never. Ship a runtime change on the current line (just run the workflow) when it works
with the servers already deployed: a new OpenCode release, a new tool in the image, a fix in the
entrypoint that reads the same environment.

Bump the major only when the runtime needs a server change to work, for example a new required
environment variable, a changed setup or auth handshake, or a removed one the server still sends.
Then:

1. Set `RUNTIME_IMAGE_MAJOR` to the next number in the same pull request as the server change.
2. Merge and run **Release GitTerm** with `both`, or run `runtimes` first and then `platform`.
   Do not deploy the server until the new `:<major>` tags exist.
3. Installs on older versions keep their previous line, which stops moving. Installs
   using legacy untagged references still follow `latest` / `default`.

## Roll back a bad build

Point the major at an earlier exact build. If promotion fails partway through, check both
registries and restore any aliases that moved. Promotion is not atomic across images and templates.

```sh
docker buildx imagetools create -t opeoginni/gitterm-opencode-server:1 opeoginni/gitterm-opencode-server:1.56.1
```

For E2B, assign the tag back to the earlier build with `Template.assignTags("gitterm-opencode-server:1.56.1", "1")`
for each template and size.

## First run

The seed references `:1` from this change on. Use `both` for the first release so the
runtime line is ready before the platform release starts.

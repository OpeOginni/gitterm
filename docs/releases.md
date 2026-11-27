# Releasing GitTerm

Feature PRs can add Changesets without access to npm, Docker Hub, E2B, or Railway.
From an up-to-date branch off `main`, run `bun run release:version` to turn the
pending Changesets into version, changelog, and lockfile changes. Open a release
PR and merge it after CI passes. Commit the versions before publishing them.

## One-time setup

1. Require passing CI and code-owner review on `main`. Keep the default Actions
   token read-only and leave write tokens and secrets disabled for fork PRs.
   Do not run contributor code via `pull_request_target` or pass PR artifacts
   to privileged release jobs.
2. Create GitHub environments `npm-candidate`, `npm-production`, `runtime-build`,
   and `image-production`. Restrict **each** to the `main` branch, not tags.
   Require reviewer approval on `npm-production` and `image-production`. Disable
   admin bypass and prevent self-review if a second maintainer can approve releases.
3. For each existing `@gitterm/{agent-runtime,sdk,opencode,cli}` package, configure
   two [npm trusted publishers](https://docs.npmjs.com/trusted-publishers):
   repository `OpeOginni/gitterm`, workflow `release-npm.yml`. For `npm-candidate`,
   allow direct publish but not dist-tag management. For `npm-production`, allow
   dist-tag management but not direct publish. Set the matching environment
   name on each publisher. Keep account 2FA enabled and remove any old npm
   automation token after verifying the new configuration.
4. Move `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, and `E2B_API_KEY` from repository
   secrets into `runtime-build` and `image-production`. Put `E2B_SMOKE_API_KEY`
   in `runtime-build` only, scoped to the separate smoke-test E2B team. Verify
   no other workflow uses the old repository secrets before deleting them.
   Do not store private Compute or production database credentials in this
   public repository.

Set the environment protections **before** the first dispatch. Mentioning an
environment in YAML does not configure approvers or branch restrictions.

## Publish and promote

1. Dispatch **Release npm packages** on `main` with the reviewed release commit's
   full SHA. The run stops if `main` moved before dispatch. It packs the versions
   not yet on `latest`, then publishes those tarballs to npm under `candidate`.
   A candidate is public and can satisfy semver ranges. Use exact versions when
   testing, and do not treat the tag as a privacy boundary.
2. If the release affects Compute, merge a pin PR in the private Compute repo
   for the exact published runtime and CLI versions. Verify the deployed revision
   and health. Rebuild its managed E2B templates if their inputs changed. If
   standalone provider images need updating, run **Release GitTerm** on `main`
   with `target=runtimes`. The runtime workflow uses the exact CLI version from
   that commit and requires approval before moving the runtime aliases.
   Use **Pi version** to build `opeoginni/gitterm-pi` with `latest` or a specific
   stable version. Publish runtimes before the first platform-only release that
   checks for this image. Use the image as a Pi prebuilt without the Pi install
   command; providers that install Pi at startup still use the platform's pin.
3. Apply only the database migrations or catalog updates the release needs.
   For managed provider catalog changes, run `compute:setup` inside the Gitterm
   Railway service after Compute is healthy and advertises the expected images.
   Back up and drain old workspaces before destructive migrations. Downgrading
   an app does not undo a database migration.
4. After the backend and required templates are ready, approve `npm-production`
   on the same npm run. It checks that `latest` and `candidate` have not moved
   unexpectedly and promotes the recorded versions, with the CLI last.

For a partial npm failure, rerun failed jobs on the same run. Published versions
are immutable; the candidate job verifies the registry tarball checksum before
reusing a version. Do not move `latest` by hand to work around a failed check.

The npm workflow does not deploy Railway or access private Compute. Production
Railway source settings are unchanged by this PR. Before switching off automatic
deploys from `main`, prove that both projects can promote and roll back a pinned
revision in staging. Move the Compute pin PR and catalog refresh into the release
pipeline after that cutover. Releases for the bot npm packages remain separate.

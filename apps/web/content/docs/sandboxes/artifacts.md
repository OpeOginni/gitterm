---
title: Artifacts
description: Download a file a sandbox job produced and apply it to your checkout, with hash checks and a refusal when the target changed locally.
---

This page shows how to bring a file built in a sandbox, such as a build output or a generated file, back into your checkout. Read it when a job has produced a file you want locally. The tool arguments are in [Tools](/docs/sandboxes/tools#sandbox_artifact).

Nothing touches your checkout until you approve it: the agent first downloads the file to a staging folder (`sandbox_artifact`), then copies it in (`sandbox_apply`).

## Get a file back

1. Ask your agent for the file, for example:

   ```text
   Download dist/app.tar.gz from the sandbox and apply it to my checkout.
   ```

   The agent downloads the file to a staging folder outside your checkout (`~/.cache/gitterm/sandbox-artifacts/`, or under `$XDG_CACHE_HOME` if set) and checks its sha256 against the copy in the sandbox. The file has to come from a job that ran after a sync, which is the usual order.

2. Approve the apply. OpenCode asks every time; "Always" is not offered for this one.

   You should see `Applied artifact from job <job id>` with the target path and sha256. If the download is reported as `verified false`, it doesn't match the sandbox file: ask the agent to download it again.

## Size limits

| Account | Largest artifact |
| ------- | ---------------- |
| Direct  | 64 MiB           |
| Managed | 32 MiB           |

On Boat the limit is 5 MiB, because Boat returns at most 5 MiB per file read.

## When apply refuses

`sandbox_apply` compares the target with the snapshot the job ran on, not your latest sync. So applying an old build can never overwrite newer local work. It refuses when:

- the target changed locally since that snapshot, or did not exist then and does now
- the target or any parent directory is a symlink, or is not a regular file or directory, so the write cannot escape the checkout
- the downloaded file changed after it was verified
- the session's checkout is not the one the job ran on
- the job did not run on a synced snapshot

If the target changed, decide what to keep. To take the sandbox version on top of your current work: sync again, rerun the job, and download a fresh artifact.

When apply succeeds, it writes the exact verified bytes, and checks the parent directory again just before the final rename.

# Cloud handoff benchmark

Measures the checkout half of `/cloud` using the current `captureSnapshot` and restore
scripts. Everything runs in temporary local repositories. No workspace, provider, or model
is called, and no data is uploaded. The temporary repositories are removed on exit.

## Run

From the repository root, after `bun install`, with Bun, Git, and Node on your PATH:

```bash
bun benchmarks/handoff/bench-handoff.ts --only matrix
bun benchmarks/handoff/bench-handoff.ts --only scale
bun benchmarks/handoff/bench-handoff.ts --only repo --repo ../other-checkout
bun benchmarks/handoff/bench-handoff.ts # all three sections
```

| Section  | Measures                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix` | Feature branches, detached HEAD, shallow clones, worktrees, CRLF, renames, and rewritten origins against full and depth-1 clones. Unexpected failures exit nonzero. |
| `scale`  | Origins with 5 to 60 MiB of history and untracked files of 1 to 24 MiB.                                                                                             |
| `repo`   | Capture and restore of this checkout, or `--repo`, including uncommitted changes. The source checkout is not modified.                                              |

This does not measure workspace creation, network uploads, or conversation import. For the
OpenCode HTTP compatibility check, use `scripts/opencode-handoff-smoke.ts` with
`OPENCODE_HANDOFF_SMOKE_BINARY` pointing to a local OpenCode executable.

## Compare runs

Use the same machine and record the commit, Bun, Node, and Git versions alongside the
output. Compare upload bytes, capture/restore time, and peak memory. Timings are local,
not predictions of cloud latency. Capture currently holds file contents in several forms,
so memory use can be much larger than the upload.

Keep saved output and dated measurements in `.local/`, which Git ignores:

```bash
mkdir -p benchmarks/handoff/.local
bun benchmarks/handoff/bench-handoff.ts --only matrix > benchmarks/handoff/.local/matrix.txt
```

# Provider benchmarks

These benchmarks measure provider performance separately from correctness tests. Results are observations, not pass/fail thresholds.

## Metrics

Control-plane timings:

- Workspace creation API response
- Cold start until the workspace is ready
- In-workspace benchmark execution
- Pause API response
- Restart API response and time until ready
- Termination API response

Workspace measurements:

- Portable single-thread CPU throughput
- Flushed filesystem write throughput
- Cached filesystem read throughput
- Reported CPU model, logical CPU count, memory, architecture, and Bun version

The workload runs in the repository directory so disk results represent the workspace filesystem rather than `/tmp`. CPU and disk numbers are useful for comparisons, but they are affected by noisy neighbors, caching, throttling, and provider load. Run several samples before drawing conclusions.

## Running locally

```bash
export GITTERM_SERVER_URL=https://staging-api.example.com
export GITTERM_API_TOKEN=gt_...
export GITTERM_E2E_REPO=https://github.com/octocat/Hello-World

bun run benchmark:providers --provider e2b --output benchmark-results/e2b.json
bun run benchmark:providers --all --output benchmark-results/all.json
```

Optional workload settings:

```bash
export GITTERM_BENCHMARK_TIMEOUT_MS=900000
export GITTERM_BENCHMARK_CPU_ITERATIONS=20000000
export GITTERM_BENCHMARK_DISK_MIB=64
```

`--all` is local-only. GitHub Actions benchmarks only Railway, E2B, and Daytona on the hosted application.

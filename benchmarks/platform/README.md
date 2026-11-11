# Platform benchmarks

Load tests for the parts of GitTerm every workspace request passes through, run entirely on
one machine. `benchmarks/providers` measures the cloud providers; this measures GitTerm itself.

```
client -> Caddy (apps/proxy/Caddyfile)  -> forward_auth -> API server (real code)
                |                                                      |-> Postgres (Docker, tmpfs)
                '-> mock workspace upstreams (upstream.ts)             '-> Redis (Docker)
```

Nothing here touches a real database or provider: the API server is started with a clean
environment from a directory with no `.env` files, pointed at containers on ports 5439 and 6380.

## Run

Needs Docker, Bun and `caddy` on the PATH.

```bash
bun benchmarks/platform/rig.ts up          # ~10 s: containers, migrations, 100k workspaces, server, Caddy
bun benchmarks/platform/bench-resolve.ts   # the forward_auth endpoint on its own
bun benchmarks/platform/bench-proxy.ts     # end to end: overhead, payload sizes, SSE, WebSocket, reuse
bun benchmarks/platform/bench-db.ts        # hot queries, with and without candidate indexes
bun benchmarks/platform/bench-snapshot.ts  # cost of a run-watcher snapshot as a session grows
bun benchmarks/platform/rig.ts down        # stops everything, removes containers, logs and results
```

`rig.ts up` takes `--workspaces`, `--scenario`, `--upstreams`, `--tls-upstreams` and
`--caddyfile`. After changing API code run `rig.ts restart-server`; after changing a Caddyfile run
`rig.ts restart-caddy --caddyfile <path>`. Logs, the generated Caddyfile and result JSON go to
`$GITTERM_BENCH_STATE` (default: a `gitterm-bench` folder in the system temp directory).
`rig.ts down --keep-results` leaves that folder in place.

## What each script answers

| Script                                  | Question                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench-resolve.ts`                      | How many Redis commands and SQL statements does one proxied request cost the API, and how many requests per second can one API process authorize, for each kind of route? |
| `bench-proxy.ts --only overhead`        | How much latency does the proxy path add over talking to the workspace directly?                                                                                          |
| `bench-proxy.ts --only download,upload` | Does throughput hold from 1 KB to 128 MB bodies in both directions?                                                                                                       |
| `bench-proxy.ts --only reuse`           | How many new upstream connections does Caddy open when traffic is spread over many workspaces?                                                                            |
| `bench-proxy.ts --only sse,ws`          | Are event streams delivered without buffering, and what does a WebSocket round trip cost?                                                                                 |
| `bench-proxy.ts --only idle`            | How much memory do idle terminal connections hold in Caddy and the API?                                                                                                   |
| `bench-db.ts`                           | Which hot queries scan a whole table at 100k workspaces, and what does an index change?                                                                                   |
| `bench-snapshot.ts`                     | How many bytes and requests does the run watcher pull per second of an active run?                                                                                        |

## Reading the numbers

- Everything runs on loopback, so absolute latency is a floor. Compare runs with each other
  (direct against proxied, before a change against after), not with production.
- The load generator is closed loop: each of `c` workers sends its next request when the last
  one returns. Latency at high `c` includes queueing in the generator's own event loop.
- On macOS a closed socket holds its port for 30 s and there are about 16k ports. A run that
  opens a new connection per request will exhaust them and show up as `network` or 502 errors.
  That is a result, not a rig fault: use `--cooldown 33` to measure such a path in bursts.
- The mock TLS workspaces use a self-signed certificate, so the rig adds
  `tls_insecure_skip_verify` to its copy of the Caddyfile. The handshake cost is unchanged.

Also in this folder: `bench-exec-server.ts` runs the sandbox exec-server in a container on
its own (no rig needed) and checks output limits, timeouts and file transfer.

## Repeatable runs

Run `bun install` first. Start Docker explicitly; the rig does not launch or quit Docker
Desktop. Ports 5439, 6380, 3100, 8899, and the upstream ranges starting at 4500 and 4800
must be free. Do not run two rigs at once. `up` replaces the benchmark database's seed data.

For a smaller smoke run before a full measurement:

```bash
bun benchmarks/platform/rig.ts up --workspaces 1000 --scenario 10 --upstreams 2 --tls-upstreams 2
bun benchmarks/platform/bench-resolve.ts --only private --duration 1 --concurrency 1,16
bun benchmarks/platform/bench-proxy.ts --only sse,ws
bun benchmarks/platform/rig.ts down --keep-results
```

Each result gets a timestamped filename, so running another proxy section does not
overwrite the earlier results. `--name` adds a label. Set `GITTERM_BENCH_STATE` to select
another runtime directory and `GITTERM_BENCH_RESULTS` to retain results elsewhere. Keep
those settings the same for every command in a run. `down --keep-results` stops services
and removes the benchmark containers while retaining the runtime directory.
Choose an empty runtime directory or one already marked by the rig; existing non-benchmark
directories are refused so cleanup cannot claim unrelated local data.

The database benchmark compares plans without the listed comparison indexes against
plans with candidate indexes. It rolls back every index change; the baseline is not the
current production schema. Run it without concurrent resolver load.

Save the commit, tool versions, rig sizes, and command alongside results when comparing
runs. Snapshot measurements use a mock OpenCode API, not a real agent run. Private-route
throughput should be measured both with warm caches and across session cache expiry.

## Local output

Runtime state includes a benchmark session cookie and temporary TLS keys. Do not commit
state, logs, generated Caddyfiles, or raw incident notes. Dated notes belong in `.local/`,
which Git ignores. The old experiment patches were removed after their fixes were committed;
these benchmarks always exercise the checked-out source.

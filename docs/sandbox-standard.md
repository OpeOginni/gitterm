# Sandbox and agent standard

GitTerm runs any supported agent on any supported sandbox, and lets a user switch either one.
To keep that cheap as both lists grow, a provider implements one contract and an agent
implements another. Everything else is shared, so adding a provider or an agent costs one
implementation instead of one per product.

| Contract                 | Who implements it | Where                                         |
| ------------------------ | ----------------- | --------------------------------------------- |
| `SandboxTransport`       | Each provider     | `packages/agent-runtime/src/sandbox/types.ts` |
| `SandboxProviderProfile` | Each provider     | `SANDBOX_PROVIDER_PROFILES` in the same file  |
| `AgentProvisioner`       | Each agent        | `packages/api/src/service/agents/types.ts`    |

The agent contract is described in [agent-integrations.md](agent-integrations.md). This
document covers the provider side and the provider research behind it.

## What a provider gets from a transport

A transport has two parts:

- Managing the machine: `create`, `info`, `list`, `destroy`, `pause`, `resume`, optional
  `keepAlive` and `snapshots`. This is always the provider's own API.
- Connecting to it: `run`, `writeFile`, `readFile` and `preview`. A command that exits
  non-zero is a result, not an error. There are three kinds of connection:

| Connection                          | Providers                                    |
| ----------------------------------- | -------------------------------------------- |
| The provider's command API          | E2B, Daytona, Vercel, Boat, exe.dev, Gitterm |
| GitTerm's command server, over HTTP | Railway (deprecated), AWS plain sandboxes    |
| SSH                                 | None yet; the Mac hosts and Lambda need it   |

With only a transport and its profile, a provider supports:

- Plain sandboxes from the SDK, `gitterm sandbox`, and the OpenCode sandbox plugin, in managed
  and direct mode.
- Agent workspaces on a Gitterm server, through `TransportWorkspaceProvider`
  (`packages/api/src/providers/transport-workspace.ts`).
- Direct agent workspaces from the SDK, with the caller's own provider account, through
  `createTransportDirectProvider` (`packages/sdk/src/direct/transport.ts`).
- Commands in a running workspace (`ComputeProvider.execCommand`), which T3 pairing uses.

### Workspaces on a transport

Both kinds of workspace run the same steps, `provisionWorkspace` in
`packages/agent-runtime/src/sandbox/workspace.ts`, using transport calls only:

1. `create` with the image's template, the machine profile's options and the workspace's
   environment. The image's `imageProviderMetadata[provider]` gives `image` (or `template`,
   or `templateId`) as the template, and `setupCommands`. Every other key is passed to the
   transport as `machine`. Without a template, the transport uses its default image.
2. Run `setupCommands`, which install the agent on a plain image, unless the workspace starts
   from a project snapshot.
3. Clone the repository into `<workspaceRoot>/<repo>` and write the agent's files.
   `workspaceRoot` is in the provider's profile; `resolveProjectDirectory` reads it too.
   `~/` in an agent file means the sandbox user's
   `$HOME`, which an image can set apart from the provider's default (Daytona runs the
   runtime image with `HOME=/workspace`).
4. Run the blocking setup command, capture the agent's access credential, and start the
   agent's serve command.
5. `preview` the agent's port; the proxy routes the workspace there.

On a server, the workspace keeps a `sandbox:<provider>:<id>` handle, so `withSandboxHandles`
sends pause, resume, terminate, status, keep-alive and exec to the transport. A direct
workspace keeps the transport's id; one started on a sandbox the caller already had (an
exe.dev VM) keeps `existing:<id>`, and terminating it stops the agent instead of deleting
the sandbox.

A resume must start the agent again when the provider's pause kills processes. If the
profile sets `resumeCommand: true`, the transport runs the start command itself (only
Gitterm's own sandboxes do). Otherwise the workspace writes it to `~/.gitterm/resume.sh`,
and `afterResume` runs that script after every resume. The start command does
nothing when the agent already answers on its port. Where a resume changes the preview URLs
(`resumeChangesPreviewUrls`, Vercel), the resume returns the agent's new URL.

Workspaces on a transport don't offer SSH editor access.

### Adding a provider

1. Write `packages/agent-runtime/src/sandbox/<provider>.ts` implementing `SandboxTransport`,
   and add its profile to `SANDBOX_PROVIDER_PROFILES` and its key to `SANDBOX_PROVIDERS`.
2. Add its managed credentials to `managedSandboxTransport`
   (`packages/api/src/service/sandbox-transport.ts`).
3. Register workspaces with one line in `packages/api/src/providers/index.ts`:
   `new TransportWorkspaceProvider("<provider>", { label: "<Name>" })`, and for direct
   workspaces add a config type and a `createTransportDirectProvider` call in
   `packages/sdk/src/direct/`.
4. Seed the runtime image for it (`imageProviderMetadata.<provider>.image`) and its machine
   profiles, with `vcpus`, `memoryGb` and the options the transport reads.
5. Run the transport tests and a live smoke test ([provider-testing.md](provider-testing.md)).

A provider without a command API runs the GitTerm command server
(`packages/agent-runtime/src/sandbox/exec-server.ts`) as its start command, as Railway and
AWS plain sandboxes do. A provider that only offers SSH needs an SSH connection (see
[Next steps](#next-steps)).

### Providers today

| Provider                                     | Workspaces                   | Notes                                                                                                                                                            |
| -------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2B, Daytona, Vercel, Boat, exe.dev, Gitterm | `TransportWorkspaceProvider` | Direct SDK workspaces on all but Gitterm use `createTransportDirectProvider`.                                                                                    |
| AWS                                          | Its own `ComputeProvider`    | Needs per-workspace IAM roles, EFS for files across a pause, and ALB routes, which a transport can't express yet. Pausing ECS loses the disk without EFS.        |
| Cloudflare                                   | Its own `ComputeProvider`    | No transport: its worker has no file calls, and a pause loses the disk, so a resume must provision again.                                                        |
| Railway                                      | None (deprecated)            | Plain sandboxes and direct SDK workspaces (its own adapter) still work and are deprecated. Railway's Sandboxes product (beta) has no pause and no custom images. |

For AWS, Lambda MicroVMs (launched June 2026) is the closest AWS service to a transport:
Firecracker VMs from an image, a per-VM IAM role, an authenticated URL per port, and a
suspend that keeps memory and disk. It has no command or file API, so it would run the
command server, and a VM lives at most 8 hours including time suspended. It fits as a
separate short-lived provider, not as a replacement for ECS.

## How providers differ

The ComputeSDK board (computesdk.com/benchmarks/sandboxes, runs of Nov 20 to 23, 2026)
lists 41 sandbox providers. Their docs show eight ways they differ. The table says how the
profile expresses each one today and what it needs.

| Difference            | What providers do                                                                                                                                                                                                                | Profile today                                           | Needed                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| What a pause keeps    | Nothing, no pause (Modal, Daytona GPU). Disk only (Runloop, Northflank, Buddy). Memory and processes (Blaxel, Freestyle, Sprites, Namespace, Superserve, Isorun). Some suspend when idle and wake on a request.                  | `pause: "stateful" \| "state-losing"`                   | `pause: "memory" \| "disk" \| "none"`, and whether a request wakes the sandbox. The resume script covers `disk`. |
| Snapshots and forks   | None, disk snapshot, memory snapshot, or a live fork of a running sandbox (Tensorlake, Isorun, Kosa8, SFCompute, Arker, Mosaic)                                                                                                  | `snapshots: "pauses" \| "stops" \| "none"`              | Whether a snapshot keeps memory, and a `fork` call where the provider has one                                    |
| Commands and files    | Native exec with an exit code (most), SSH only (AWS Mac, Scaleway, Orka, Lambda, Vast), or a binary inside your own container (Cloud Run)                                                                                        | `run`, `writeFile`, `readFile`                          | An SSH transport, so SSH-only machines need no per-provider code                                                 |
| Ports                 | A URL per port, one URL per sandbox (Sprites, Briq, Hopx), or none. Public, token, or org login.                                                                                                                                 | `previews: "private" \| "public" \| "either" \| "none"` | One-URL providers can host one agent port only; the command server can forward the rest                          |
| Machine size          | Named tiers, CPU and memory numbers, memory only (Blaxel, Sandbox0), fixed (Sprites), or set by the template (E2B, Superserve)                                                                                                   | Machine profiles: `vcpus`, `memoryGb`, provider options | Nothing for CPU and memory. Profiles need a GPU description                                                      |
| OS, architecture, GPU | Linux x64 everywhere. arm64 on Namespace, Runloop, Sail, Arker, AWS. macOS on Namespace and Mac hosts. Windows on Namespace (early access) and Arker. GPUs on Modal, Daytona, Northflank, Beam, RunPod, Koyeb, Tensorlake, Arker | Not expressed                                           | `platform: { os, arch, gpus }` per provider, and a GPU type and count per machine profile                        |
| Images                | Any OCI image, a Dockerfile-built template (Blaxel's must contain its own agent), a fixed image (Sprites, Upstash), or a base VM you fork (Freestyle, Arker)                                                                     | `imageProviderMetadata[provider]`                       | Nothing. Fixed-image providers install the runtime in a setup step, which is slower                              |
| Lifetime and billing  | Max lifetime (Modal 24h, Namespace 3 to 24h by plan), idle action, per-ms to hourly billing, and minimum billing (24h for most Macs, 1 minute on Namespace)                                                                      | `expiry`, `maxLifetimeMs`                               | A minimum billing period, so GitTerm doesn't pause a machine it pays for by the day                              |

## Providers worth adding

By what they sell. "Unverified" means the research found it only on a homepage or in a
search snippet.

### GPUs

| Provider   | Commands                                   | GPUs                     | Billing         | Notes                                                              |
| ---------- | ------------------------------------------ | ------------------------ | --------------- | ------------------------------------------------------------------ |
| Daytona    | Already integrated                         | H100 to B300, MI355X     | Per second      | No pause or fork for GPU sandboxes; stopping one deletes it        |
| Modal      | Native exec                                | T4 to B300, up to 8      | Per second      | No pause. 24h max lifetime. GPU sandboxes run on gVisor            |
| Northflank | Native exec, files as tar over exec        | L4 to B200, 8x H100/H200 | Per second      | Scale to zero wipes the disk outside volumes. Bring your own cloud |
| RunPod     | Native exec (25 s and 1 MiB caps), and SSH | Up to B300               | Per second      | Any Docker image                                                   |
| Beam       | Native exec                                | T4, A10G, 4090, H100     | Per millisecond | GPU sandbox billing unverified                                     |

Daytona is the cheapest start: it is already a provider, so GPU workspaces need GPU machine
profiles and handling for "no pause". Modal is the broadest per-second GPU option.

### macOS

Apple's licence requires leases of at least 24 hours, and at most 2 macOS VMs per Mac. Most
providers bill Macs by the day for that reason.

| Provider        | Access                           | Minimum billing | Notes                                                                              |
| --------------- | -------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| Namespace       | API, commands through `nsc ssh`  | 1 minute        | M4 Pro, macOS 14 to 27. Also arm64 Linux and Windows. Check the 24h rule with them |
| AWS EC2 Mac     | EC2 API, commands over SSH only  | 24 hours        | Dedicated host, 6 to 20 minutes to start, slow scrub after release                 |
| Scaleway        | REST API, SSH or VNC             | 24 hours        | Paris only. Unverified (pages refused automated access)                            |
| MacStadium Orka | REST API, commands over SSH only | Sales contract  | No hourly API found                                                                |

Namespace is the only per-minute option, so it fits sandboxes and short workspaces. The 24h
hosts fit a user's long-lived Mac workspace, created once and kept, and need the SSH
transport.

### Speed, and pauses that keep memory

Isorun, Blaxel, Superserve and Archil start in under 0.7 s at the median with all 100 of
100 burst starts succeeding, and their pause keeps memory. Blaxel suspends after about 15 s
idle and resumes in under 25 ms. These suit workspaces that sleep between messages. For
comparison, E2B measured 1.04 s and Boat 12.83 s with 48% of burst starts succeeding.

### Not a fit

CodeSandbox is deprecated, Cua's cloud closed in October 2026, Fly GPUs are gone, Tart's
licence bans competing commercial use, and Run Cloud only runs phone simulators. CreateOS,
Sail and Sprites succeeded on under 50% of burst starts.

## Next steps

1. Check each moved provider live with `scripts/provider-smoke.ts` (workspaces) and
   `scripts/sandbox-smoke.ts`.
2. Add the SSH connection. It makes the Mac hosts, Lambda and Vast one implementation.
3. Extend the profile with `platform` and the three pause levels, and machine profiles with
   a GPU. Do it with the first GPU or macOS provider, so a real provider checks the shape.
4. Add Daytona GPU profiles, then Namespace for macOS and arm64.

## Verification

```bash
# Unit tests for the generic workspace, with a fake transport.
cd packages/api && bun test src/providers/transport-workspace.test.ts

# A real OpenCode workspace on a Docker container posing as a transport-only provider.
# Stops and starts the container to check that a resume starts the agent again.
GITTERM_SANDBOX_DOCKER_TESTS=1 bun test src/providers/transport-workspace.docker.test.ts

# The same for a direct SDK workspace, through the real direct client.
cd packages/sdk && GITTERM_SANDBOX_DOCKER_TESTS=1 bun test src/direct/transport.docker.test.ts
```

The Docker test uses the locally built runtime image `gitterm-release-local-opencode:verify`.
Set `GITTERM_RUNTIME_IMAGE` to use another.

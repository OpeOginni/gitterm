# Cloudflare Sandbox Provider

Runs GitTerm workspaces on [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) — Durable-Object-backed Linux containers — fronted by a Cloudflare Worker.

There are **two** workers in this directory:

| Worker                  | Path                     | Purpose                                                                 |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Compute sandbox worker  | `sandbox-worker/`        | Backs normal opencode workspaces (the `ComputeProvider`).               |
| Agent-loop worker       | `agent-worker/`          | Legacy autonomous agent-loop runner (`CloudflareSandboxProvider`).      |

Both share one Cloudflare provider config row (`providerKey = "cloudflare"`).

## How the compute provider works

- `compute-provider.ts` implements the standard `ComputeProvider` interface.
- `createWorkspace` POSTs a provisioning payload to the worker's
  `POST /__gitterm/provision` control endpoint (authenticated with the shared
  `internalApiKey`). The worker creates a sandbox, clones the repo, writes the
  opencode config/credentials, and starts `opencode serve` on port `4096`.
- The provisioning payload is persisted in the sandbox's **Durable Object
  storage**, so it survives container sleep. Container *filesystem* state does
  not survive sleep, so `restartWorkspace` calls `POST /__gitterm/restart`,
  which re-clones the repo and restarts opencode from the stored payload
  (ephemeral + reclone model).
- Workspace traffic is routed **by header**, not by preview-URL hostname.
  GitTerm proxies requests to the worker (`upstreamUrl`) with
  `x-gitterm-cf-sandbox-id`, `x-gitterm-cf-internal-key`, and optionally
  `x-gitterm-cf-port`. The worker authenticates and `containerFetch`es to the
  right sandbox/port. This means a plain `*.workers.dev` URL works — no custom
  domain or wildcard DNS required.

Lifecycle endpoints (all `POST`, `Authorization: Bearer <internalApiKey>`):

- `/__gitterm/provision` — create + boot a sandbox.
- `/__gitterm/restart` — reboot from the stored payload.
- `/__gitterm/stop` — kill processes so the container idles (storage kept).
- `/__gitterm/terminate` — `destroy()` the sandbox (storage wiped).
- `/__gitterm/status` — report whether opencode is reachable.

## Setup

Two paths are supported.

### 1. Automatic (simple) setup

Provide a Cloudflare **API token** and **account ID** in the admin panel and run
the Cloudflare bootstrap (`admin.cloudflare.bootstrap`). GitTerm runs
`bunx wrangler deploy` against your account using the bundled
`sandbox-worker/wrangler.jsonc`, injects a generated `INTERNAL_API_KEY`,
resolves the deployed `*.workers.dev` URL, and saves everything back into the
provider config.

The worker references a **public** prebuilt container image
(`docker.io/opeoginni/gitterm-cf-sandbox`), so **Docker is not required** on the
machine running the deploy — Wrangler only uploads the worker and wires up the
container application. `wrangler` is just an npm dependency (invoked via
`bunx`), not a system tool.

> Pure REST-API deploy was evaluated and rejected: the worker script upload is
> REST-able, but **container-application creation is not part of the stable
> Cloudflare REST API / SDK** (only Wrangler orchestrates it). Using the public
> image keeps us on the supported path while removing the heavy Docker
> dependency.

The API token needs permissions to deploy Workers, Durable Objects, and
Containers (Workers Scripts: Edit, Workers Subdomain: Read, Account
Containers: Edit).

### Publishing the container image (maintainers, one-time)

The public image is built from `sandbox-worker/Dockerfile` and pushed by
maintainers (this is the only step that needs Docker, and it never runs on a
user's host). Run it from the repo root, either on its own or as part of the
full agent image refresh:

```bash
bun run docker:cf-sandbox:build   # builds + pushes opeoginni/gitterm-cf-sandbox:0.12.1
bun run opencode-upgrade          # rebuilds all agent images, including cf-sandbox
```

Keep the image tag in sync with the `@cloudflare/sandbox` npm version.

### 2. Manual setup

Download the setup ZIP from the provider page (or use the worker files in
`sandbox-worker/`), then deploy and set the secret:

```bash
npm install            # pulls @cloudflare/sandbox so wrangler can bundle the worker
npx wrangler login
npx wrangler deploy
# Enter a strong INTERNAL_API_KEY value when prompted:
npx wrangler secret put INTERNAL_API_KEY
```

`INTERNAL_API_KEY` is stored as an encrypted Cloudflare **secret** (not a
plaintext var), so it is not visible in the dashboard.

By default the worker references our public prebuilt image
(`docker.io/opeoginni/gitterm-cf-sandbox`), so `wrangler deploy` needs **no
Docker** locally. To build the image yourself instead, switch the `image` field
in `wrangler.jsonc` to `./Dockerfile` (this requires Docker running locally
during deploy).

Then in the admin panel set:

| Field            | Required | Notes                                            |
| ---------------- | -------- | ------------------------------------------------ |
| `Worker URL`     | Yes      | The deployed `*.workers.dev` (or custom) URL     |
| `Internal API Key` | Yes    | Must match the `INTERNAL_API_KEY` you deployed   |

`admin.cloudflare.manualSetup` returns the exact command + steps for the UI.

## Config fields

Defined in `packages/schema/src/provider-registry.ts` and typed in
`packages/api/src/providers/cloudflare/types.ts`:

- `apiToken` (automatic setup only)
- `accountId` (automatic setup only)
- `workerName` (defaults to `gitterm-sandbox`)
- `workerUrl`
- `internalApiKey`
- `callbackSecret` (legacy agent-loop only)

## Limitations

- Editor SSH access is not supported.
- No persistent filesystem across stop/restart — the working tree is recloned
  on restart. (R2 bucket mounting could be added later for true persistence.)
- `*.workers.dev` does not support wildcard preview-URL DNS, which is why the
  provider uses header-based routing through the worker instead of
  `exposePort()` preview URLs.

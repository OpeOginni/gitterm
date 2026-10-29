# Agent integration contract and T3Code audit

## Research baseline

Updated on 2026-10-29 against published T3 0.1.4 and OpenCode 2.2.1.
The compatibility checks run both released CLIs, including T3's V2 adapter.

The published npm package now installs a self-contained executable through
`@t3code/t3-<platform>`. Its source-package Node engines and node-pty dependencies
are not an npm-install build requirement for that release. Build tools remain in
Docker/E2B for older explicit version pins; Node 22 runs npm/provider launchers.

Primary sources:

- [Release and changelog](https://github.com/pingdotgg/t3code/releases/tag/v0.1.4)
- [Released OpenCode provider guide](https://github.com/pingdotgg/t3code/blob/v0.1.4/docs/user/providers-opencode.md)
- [Released OpenCode driver](https://github.com/pingdotgg/t3code/blob/v0.1.4/packages/provider-opencode/src/server/driver.ts)
- [Released server CLI](https://github.com/pingdotgg/t3code/blob/v0.1.4/apps/server/src/cli/server.ts)
- [Released auth CLI](https://github.com/pingdotgg/t3code/blob/v0.1.4/apps/server/src/cli/auth.ts)
- [Codex native token format](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)

T3 is a harness over native agents, not an OpenCode-compatible server. Its stable
release supports Claude Code, Codex, OpenCode, Cursor, Grok Build, and Antigravity.
GitTerm's default images install the first three. Additional agents should use
T3's native installation/sign-in facilities or an administrator-configured image,
rather than another GitTerm-owned auth or orchestration implementation.

GitTerm installs only OpenCode V2, including inside T3 runtimes. T3 selects its
V2 adapter from the installed binary's version. Both integrations share the
credential importer, managed OAuth refresh, and native V2 config builders.

## OpenCode 2 runtime

The SDK and agent runtime target OpenCode **2.2.1**, with an exact matching
`@opencode/client` dependency. Runtime images install `@opencode/cli@2` by
default, so rebuild images/templates to pick up the latest published V2 release.

Standalone, direct, and T3Code workspaces use native `plugins` entries, including package
options, and `OPENCODE_PASSWORD` for server authentication. Server settings go
to `~/.config/opencode/opencode.json`; the saved theme goes to
`~/.config/opencode/cli.json` as `theme.name`.
Saved config validation imports `@opencode/schema` at the same pinned version as
the client. No generated schema copy or download is needed.

Run the isolated compatibility check with an installed matching CLI:

```sh
OPENCODE_SMOKE_BINARY="$(command -v opencode)" bun run test:opencode
```

The check starts real loopback servers with fresh homes and synthetic credentials.
It covers hosted/direct provisioning, plugin options, API-key import, managed
OAuth refresh, service registration, single-use browser and TUI pairing, question
and permission replies, PTY setup, SDK execution and model variants, event streaming,
shell tool output, continuation, cancellation, and session deletion. Model responses
and GitTerm token refreshes come from a loopback fixture, not paid services. CI runs
the same check on Linux.

## Standard contract

`packages/schema/src/agent-capabilities.ts` declares GitTerm-owned capabilities.
`packages/api/src/service/agents/index.ts` is the typed provisioner registry.
Each agent implements the same interface:

1. A stable `key`, capability declaration, and optional credential-mint command.
2. `provision(context)` returns opaque files, environment, launch command/port,
   and authentication requirements.
3. Compute providers clone the repository, install the configured runtime, write
   files, run blocking setup, capture an agent credential when required, and
   launch the declared command. Providers do not interpret agent config formats.
4. The proxy delegates primary-route authentication to the selected agent;
   separately exposed private ports keep GitTerm authentication.
5. Agent run adapters are a separate capability. T3's native orchestration API is
   not implicitly an implementation of GitTerm's OpenCode run contract.

Server decisions use the database's `provisionerKey`, not a display-name prefix.
Legacy name resolution is limited to older proxy cache entries and UI callers
without a key. Dashboard pairing controls and MCP selection use the shared
capability declaration as well. Unknown keys fail closed.

| GitTerm capability                | OpenCode          | T3Code                       |
| --------------------------------- | ----------------- | ---------------------------- |
| Primary authentication            | Server password   | Native one-time pairing      |
| GitTerm run API / bots            | Server workspaces | Not implemented              |
| GitTerm-managed MCP connections   | Yes               | Not implemented              |
| Central OAuth refresh integration | Yes               | OpenCode V2 only             |
| Native saved configs              | OpenCode          | OpenCode, Claude Code, Codex |

To add an agent, register its key and capabilities, implement the provisioner,
configure provider runtime images/setup, and extend the conformance tests. Do not
add agent-name branches to individual compute providers.

## Gaps addressed

- **Project registration:** released `t3 serve` forcibly disables auto-bootstrap,
  ignoring the supplied flag. Use `t3 start --no-browser
--auto-bootstrap-project-from-cwd` in both SDK and Docker launch paths.
- **Codex config:** serialize dashboard JSON to `~/.codex/config.toml` with
  `smol-toml`, not an ignored `config.json` or a custom TOML serializer.
- **Codex auth:** retain encrypted OpenAI OIDC identity tokens on login/refresh,
  include them in native auth.json, and fail early on incomplete legacy tokens.
  A selected ChatGPT subscription is not overridden by an ambient OpenAI API key.
- **Context parity:** use native global instructions and skill directories for
  Claude, Codex, and OpenCode. Preserve repository-owned instruction files. Honor
  request-level OpenCode config/model overrides inside T3 as well.
- **Pairing parity:** one provider-neutral capture helper replaces duplicated
  best-effort implementations. boat and exe.dev now return pairing grants too.
  Required credential capture failures do not report a usable workspace.
- **Cloudflare:** transport the standard launch/mint spec, return pairing grants,
  support control-plane exec for regeneration, and encrypt replacement grants on
  restart. An outdated worker that omits a required grant produces an error.
- **Installation:** Vercel setup must succeed before launch; exe.dev accepts
  blocking setup commands. T3 runtime setup installs `@opencode/cli@2`.
- **Updates:** resolve versions from npm, honor explicit pins in E2B builds, and
  resolve a concrete T3 Docker version before installation. GitHub release tags
  alone are not proof that an npm package has been published.
- **Credential callback:** Docker's pairing reporter treats HTTP failures as
  failures and retries instead of announcing success for a 4xx/5xx response.
- **Signed pairing behind provider ingress:** reproduced on a boat workspace
  running T3 0.1.0. T3 verifies DPoP against the request's `Host` and
  `X-Forwarded-Proto`; it does not use `X-Forwarded-Host`. The provider's routing
  hostname therefore produced `auth_invalid` / `request_mismatch` even with a
  fresh link. The generated `~/.gitterm/t3-origin-bridge.cjs` keeps the provider
  route intact and restores the configured GitTerm origin at the final hop to
  loopback-only T3. It passes credentials through unchanged and never trusts
  client-provided forwarding headers or decodes proofs to choose the origin.
  HTTP streams, cookies, and WebSocket upgrades are preserved. The launcher owns
  T3's process group so native children cannot survive a normal stop/restart.
  This is shared agent provisioning for every provider, not a boat-specific
  route. T3 workspaces require `ROUTING_MODE=subdomain` and wildcard DNS;
  path-based creation is rejected because T3's root-level endpoints and signed
  URLs do not support GitTerm's `/ws/<subdomain>` prefix.

## Deliberate limits and rollout

Native Claude/Codex auth is not GitTerm's managed-refresh protocol.
Copying a rotating OAuth refresh token into several workspaces can still compete
with central refresh. Prefer API keys or **independent native sign-ins in T3's
provider settings** for long-lived/multi-workspace use. T3's OpenCode V2 backend
uses GitTerm's existing managed-refresh plugin instead.

Older saved ChatGPT credentials may lack the required ID token. Reconnect the
account in GitTerm before creating a T3 workspace, or use an API key and complete
native ChatGPT sign-in after pairing. OpenCode 2 remains compatible with those
older dashboard credentials.

Cloudflare reconstructs its container filesystem on restart. T3's sessions,
projects, and paired-device grants do **not** survive that reconstruction; a
replacement pairing link is returned and must be used. Use a persistent provider
when T3 history and paired-device continuity are required.

AWS/Railway still use the image's callback to issue links and do not implement
provider exec. Generate another link inside T3's Connections settings, or restart
the workspace to have the entrypoint report a fresh link.

Deployment requires rebuilding T3 Docker images/E2B templates, deploying the
Cloudflare worker, and running the normal catalog seed to apply changed runtime
metadata. Existing workspaces keep their current images/config files until
recreated; a service deploy alone does not rewrite their native configuration.
For the signed-pairing fix, boat and other SDK providers need a server deploy
and a newly provisioned workspace (no new boat image is needed). An existing
boat handle retains its old launch command, so restarting it or generating more
links does not install the bridge. Preserve any uncommitted work before moving
to a new workspace; existing workspaces require a separate explicit migration.
Docker providers also need the rebuilt T3 image with the updated entrypoint.
Use a test image tag before promoting production images. No production builds,
seeding, cloud deployments, or paid model calls are performed by the local audit.

Validation:

```sh
bun test packages/api/src/service/agents packages/api/src/providers packages/schema/src/agent-capabilities.test.ts .docker/tests/workspace-startup.test.mts
bun run check-types
T3_SMOKE_BINARY=/absolute/path/to/t3 \
OPENCODE_SMOKE_BINARY=/absolute/path/to/opencode bun scripts/t3code-smoke.ts
```

The opt-in smoke test uses an isolated temporary home and a loopback endpoint. It
checks discovery, hosted-app-origin pairing, signed token exchange and API access
with a rewritten provider Host, rejection of unauthenticated requests and proofs
for a different URL, single-use tokens, one registered project, and persisted
grants/projects after a server restart. It also runs OpenCode V2 threads, shell
tools, and continuation against a loopback model fixture. It does not use real
provider accounts or prove paid cloud-provider behavior.

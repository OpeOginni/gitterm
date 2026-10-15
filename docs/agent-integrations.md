# Agent integration contract and T3Code audit

## Research baseline

Audited on 2026-10-13 against published **T3 0.0.45** (GitHub release
`v0.0.45`, commit `6c8fed35`) and upstream `main` at
`6524a8d43795dc543f7cfb572388cdea3662ad48`. npm also resolved to 0.0.45.
Distinguish released behavior from development-branch features.

The published npm package now installs a self-contained executable through
`@t3code/t3-<platform>`. Its source-package Node engines and node-pty dependencies
are not an npm-install build requirement for that release. Build tools remain in
Docker/E2B for older explicit version pins; Node 22 runs npm/provider launchers.

Primary sources:

- [Release and changelog](https://github.com/pingdotgg/t3code/releases/tag/v0.0.45)
- [Released remote-access guide](https://github.com/pingdotgg/t3code/blob/v0.0.45/docs/user/remote-access.md)
- [Released server CLI](https://github.com/pingdotgg/t3code/blob/v0.0.45/apps/server/src/cli/server.ts)
- [Released auth CLI](https://github.com/pingdotgg/t3code/blob/v0.0.45/apps/server/src/cli/auth.ts)
- [Released environment HTTP contract](https://github.com/pingdotgg/t3code/blob/v0.0.45/packages/contracts/src/environmentHttp.ts)
- [Released Codex managed runtime](https://github.com/pingdotgg/t3code/blob/v0.0.45/apps/server/src/provider/CodexManagedRuntime.ts)
- [Released package engines/dependencies](https://github.com/pingdotgg/t3code/blob/v0.0.45/apps/server/package.json)
- [Codex native token format](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)
- [Development-branch outside-agent MCP guide](https://github.com/pingdotgg/t3code/blob/6524a8d43795dc543f7cfb572388cdea3662ad48/docs/user/outside-agents.md)

T3 is a harness over native agents, not an OpenCode-compatible server. Its stable
release supports Claude Code, Codex, OpenCode, Cursor, Grok Build, and Antigravity.
GitTerm's default images install the first three. Additional agents should use
T3's native installation/sign-in facilities or an administrator-configured image,
rather than another GitTerm-owned auth or orchestration implementation.

T3's bundled OpenCode SDK is still 1.x. Keep `opencode-ai@1` in T3 runtimes;
GitTerm's standalone OpenCode runtime uses `@opencode/cli@2`. Do not share the
OpenCode 2 credential importer or assume protocol compatibility between them.

Browser tooling and the outside-agent OAuth/MCP endpoint found on upstream `main`
are not present in the audited release. They are upgrade candidates, not enabled
GitTerm features. Audit their released contracts before adding adapters. In
particular, do not silently disable Chromium's sandbox to make containers work.

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

| GitTerm capability                | OpenCode          | T3Code                          |
| --------------------------------- | ----------------- | ------------------------------- |
| Primary authentication            | Server password   | Native one-time pairing         |
| GitTerm run API / bots            | Server workspaces | Not implemented                 |
| GitTerm-managed MCP connections   | Yes               | Not implemented                 |
| Central OAuth refresh integration | Yes               | No; native backends own refresh |
| Native saved configs              | OpenCode          | OpenCode, Claude Code, Codex    |

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
  blocking setup commands. Cloudflare also installs T3's OpenCode 1.x backend.
- **Updates:** resolve versions from npm, honor explicit pins in E2B builds, and
  resolve a concrete T3 Docker version before installation. GitHub release tags
  alone are not proof that an npm package has been published.
- **Credential callback:** Docker's pairing reporter treats HTTP failures as
  failures and retries instead of announcing success for a 4xx/5xx response.

## Deliberate limits and rollout

Native Claude/Codex/OpenCode 1.x auth is not GitTerm's managed-refresh protocol.
Copying a rotating OAuth refresh token into several workspaces can still compete
with central refresh. Prefer API keys or **independent native sign-ins in T3's
provider settings** for long-lived/multi-workspace use. A new external-token
bridge would need a separately designed and tested integration; fabricating
OpenCode compatibility or editing T3's private credential database is not safe.

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
Use a test image tag before promoting production images. No production builds,
seeding, cloud deployments, or paid model calls are performed by the local audit.

Validation:

```sh
bun test packages/api/src/service/agents packages/api/src/providers packages/schema/src/agent-capabilities.test.ts .docker/tests/workspace-startup.test.mts
bun run check-types
T3_SMOKE_BINARY=/absolute/path/to/t3 bun scripts/t3code-smoke.ts
```

The opt-in smoke test uses an isolated temporary home and a loopback endpoint. It
checks discovery, hosted-app-origin pairing, single-use tokens, one registered
project, and persisted grants/projects after an abrupt server restart. It does
not authenticate native model providers or prove paid cloud-provider behavior.

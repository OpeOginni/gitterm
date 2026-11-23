# Smoke tests

What to run against real providers, in order, after a change to providers, sandboxes or moving
sessions. The steps get more expensive as you go: stop at the first one that fails.

Everything reads `scripts/.env`. Each step lists what it needs from it.

## 1. Free: tests and Docker

No provider account and no cost. Docker must be running.

```sh
bun run check-types
bun test ./packages/{api,sdk,agent-runtime,cli,move,opencode}/src
GITTERM_SANDBOX_DOCKER_TESTS=1 bun test ./packages/api/src/providers ./packages/sdk/src ./packages/move/src
GITTERM_OPENCODE_TESTS=1 GITTERM_PI_TESTS=1 bun test ./packages/move/src
```

The Docker tests run the real agent and runtime image on a local container: a server workspace
(clone, start, stop and start, resume), a direct SDK workspace (setup, pause, resume,
terminate), plain sandboxes, and a Pi workspace. The opt-in agent tests run real OpenCode and
Pi; no model is called.

```sh
OPENCODE_SMOKE_BINARY=$(which opencode) bun run test:opencode
```

Checks OpenCode compatibility with isolated homes and a stand-in model: the runtime, pairing,
the direct workspace plan and the `/cloud` handoff.

## 2. Plain sandboxes, per provider

`scripts/sandbox-smoke.ts` creates real sandboxes and destroys everything it made, even after a
failure. Write a settings file with the accounts to test. Keys are only `{env:VAR}` references:

```json
{
  "accounts": {
    "e2b": { "provider": "e2b", "apiKey": "{env:E2B_API_KEY}" },
    "daytona": { "provider": "daytona", "apiKey": "{env:DAYTONA_API_KEY}" },
    "vercel": {
      "provider": "vercel",
      "apiKey": "{env:VERCEL_API_TOKEN}",
      "teamId": "team_…",
      "projectId": "prj_…"
    },
    "boat": { "provider": "boat", "apiKey": "{env:BOAT_API_KEY}" },
    "exedev": {
      "provider": "exedev",
      "apiKey": "{env:EXEDEV_API_TOKEN}",
      "allowUnboundedLifetime": true
    },
    "gitterm": { "size": "small" }
  }
}
```

```sh
set -a; . scripts/.env; set +a
GITTERM_SANDBOX_CONFIG=./sandbox.json bun run test:sandboxes --account e2b --cli --snapshots
```

- Run it once per account. `gitterm` goes through your Gitterm login (or `GITTERM_API_TOKEN` and
  `GITTERM_SERVER_URL`) and is billed to that plan.
- It checks: create, sync (secret files left out), the test passing only with the uncommitted
  change, exit codes and timeouts, large output and paging, reattaching after a restart,
  cancelling, previews, artifacts and applying them, secret redaction, a background job and
  waiting for it, pause and resume with files kept, and that the local checkout is untouched.
- `--cli` runs the same core path through the real `gitterm sandbox` CLI, as Pi's tools and the
  `gitterm-sandbox` skill do: create, sync, a background job and `job --wait`, pause, destroy.
- `--snapshots` saves a setup snapshot, starts a sandbox from it, and deletes it. Skipped where the
  provider can't save one.
- `--crash` kills a caller mid-run and checks the provider deletes its sandbox at the end of its
  lifetime. It adds about 5 minutes.
- `scripts/.env` names Boat's key `ASCII_API_KEY`, its old name. Add `BOAT_API_KEY` with the same
  value.

## 3. Direct SDK workspaces, per provider

An agent workspace made by the SDK straight on the provider, with no Gitterm server.

```sh
bun run test:providers:direct --provider e2b,daytona,vercel,boat,exedev
```

Needs the provider keys in `scripts/.env`, `GITTERM_E2E_REPO`, and a model
(`GITTERM_E2E_MODEL`). It creates a workspace, runs the agent on a task, pauses, resumes and
terminates it.

## 4. Server workspaces, per provider

The full path through a Gitterm server: the dashboard's and `/cloud`'s workspaces.

```sh
bun run test:providers --provider gitterm,e2b,daytona,vercel,boat,exedev,aws
```

Needs `GITTERM_SERVER_URL` and `GITTERM_API_TOKEN` for a server with those providers enabled,
and `GITTERM_E2E_REPO`. Against a local server, restart it first: a long-running `bun --hot`
server stops firing timers. Daytona needs Tier 3 network access for the workspace to reach the
server. Set `GITTERM_E2E_TIMEOUT_MS=360000` to see setup failures that a shorter wait hides.

## 5. Moving sessions

```sh
bun scripts/t3-cloud-smoke.ts   # real T3 Code and Claude Code (Haiku), with your login
```

Then by hand, once per agent, against a real server: `npx @gitterm/cli setup` in a scratch HOME,
`/cloud` from OpenCode and Pi, asking Codex or Claude Code to move, and bringing each back.

# Daytona Provider

Runs gitterm workspaces as [Daytona](https://www.daytona.io) sandboxes. The
image entrypoint is overridden with `sleep infinity`; the agent server, repo
clone, and post-start (workspace setup) command are all driven from the API
side through Daytona session commands.

## Network tiers — read this first

Daytona applies **organization-tier network policies** to sandboxes
([docs](https://www.daytona.io/docs/en/network-limits/)):

- **Tier 1 / Tier 2** (email verification / $25 top-up): sandbox egress is
  locked to an "essential services" allowlist (GitHub, npm, PyPI, cloud
  providers, major AI APIs). Everything else — including `WORKSPACE_API_URL`,
  whether that's a dev tunnel or `api.gitterm.dev` — gets a TLS reset. This
  **cannot be overridden per sandbox**; `networkBlockAll: false` is ignored.
- **Tier 3 / Tier 4** ($500 top-up): full internet access; sandbox-level
  network settings are honored.

Because gitterm workspaces normally _push_ to the API (setup status reports,
the scoped `gitterm` CLI, agent credential refresh), the tier matters a lot.

## The "Tier 3+ organization" admin setting

The Daytona provider config (admin → providers → Daytona) has a
**Tier 3+ organization** toggle (`tier3NetworkAccess`), **off by default**.
Only enable it if the Daytona org backing the API key is actually Tier 3+.

**When enabled (Tier 3+):**

- Sandboxes are created with `networkBlockAll: false` so they get unrestricted
  egress and every push-based flow works normally.

**When disabled (default, Tier 1/2):**

- Setup status is reconciled by **polling**: the setup wrapper always writes
  its state to `<repoDir>/.gitterm/setup/{state,exit-code,setup.log,...}`
  inside the workspace, and `getWorkspaceSetupStatus` reads those files back
  over Daytona's `executeCommand` control channel (see
  `service/workspace-setup-reconcile.ts`). The polling is deliberately cheap:
  it only runs while a caller is actively waiting on setup status, is
  throttled to one exec per workspace per 10 seconds, stops permanently once
  setup reaches a terminal state, and each exec is capped by a 15s timeout.
- Anything that inherently requires workspace → API egress **does not work**:
  the scoped `gitterm` CLI inside the workspace (`workspace info`,
  `ports open/close`) and agent credential/heartbeat calls. Setup commands
  that use the scoped CLI will fail and surface through the polled setup log.
  Setup push reports are skipped entirely (`disablePush`) so their retry
  backoff doesn't delay setup by ~30s per report.
- The workspace catalog exposes this as `workspaceApiAccess: false` on the
  Daytona provider entry, so clients (including the provider smoke test) can
  skip scoped-CLI features instead of failing.
- Agent runs still work: the server talks _into_ the sandbox via the preview
  URL (ingress is not restricted).

## Known symptoms of a tier mismatch

If the toggle is on but the org is actually Tier 1/2, workspaces will sit in
setup `waiting` forever and, inside the sandbox, `curl $WORKSPACE_API_URL`
fails with `Recv failure: Connection reset by peer` while
`curl https://api.github.com` succeeds. Turn the toggle off (or upgrade the
Daytona org) and recreate the workspace.

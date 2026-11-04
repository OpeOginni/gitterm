---
title: Sandbox providers
nav: Providers
description: Which providers run Gitterm sandboxes, what each one supports, and the limits that change how you use them.
---

This page compares the providers that can run a sandbox for your local agent. Use it to pick a provider, and to know what happens to a sandbox you forget about. The account fields each provider needs are in [Account fields](/docs/reference/sandbox-plugin#account-fields).

## Capabilities

| Provider | Accounts        | Image                                                 | Abandoned sandbox                                                  | Previews                           |
| -------- | --------------- | ----------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| E2B      | Managed, direct | `base` template                                       | Deleted at the lifetime                                            | Private or public                  |
| Daytona  | Managed, direct | `node:22-bookworm-slim`                               | Deleted at the lifetime                                            | Private or public                  |
| Vercel   | Managed, direct | `node24` runtime                                      | Stopped at the lifetime; files discarded                           | Always public                      |
| Boat     | Managed, direct | Boat base image                                       | Stopped and archived at the lifetime; storage kept until destroyed | Always private                     |
| exe.dev  | Managed, direct | `node:22-bookworm`                                    | Never deleted by the provider                                      | Always private, ports 3000 to 9999 |
| Railway  | Managed, direct | `node:22-bookworm-slim` with Gitterm's command server | Never deleted by the provider                                      | Always private, port 8080 reserved |
| AWS      | Managed only    | `node:22-bookworm-slim` with Gitterm's command server | Never deleted by the provider                                      | Always private, port 8080 reserved |

- **Lifetime** is the time you set with `lifetimeMinutes` when creating the sandbox. The maximum is 24 hours on every provider except Vercel, where it is 5 hours.
- **Abandoned sandbox** is what the provider does on its own if OpenCode crashes or your machine goes offline.
- **Previews:** the column shows direct accounts. "Private or public" is chosen when the sandbox is created, with `publicPreviews`. A private preview rejects requests without an access header (a cookie on Boat). On an always-private provider, `publicPreviews` has no effect. With a managed account, Gitterm serves E2B, Daytona, Boat, and exe.dev previews, so those can be private or public too. See [Previews by provider](/docs/sandboxes/jobs-and-previews#previews-by-provider).

Cloudflare is not supported for sandboxes yet. It is planned.

## Cleanup after a crash

The "Abandoned sandbox" column matters most for direct accounts:

- **Managed:** Gitterm terminates every sandbox at its lifetime, whatever the provider does.
- **Direct:** only the provider can clean up. exe.dev and Railway never do. A direct account on either must set `"allowUnboundedLifetime": true` to accept that a crashed sandbox keeps running and billing. Otherwise creation is refused.

> [!WARNING]
> With a direct exe.dev or Railway account, always destroy sandboxes yourself with `sandbox_destroy`. Find leftovers with `sandbox_list`.

## Pausing (managed only)

A managed sandbox pauses after your plan's idle timeout. Paused time is not billed as active. It resumes on its next use: when the agent syncs, runs a command, reads a job, opens a preview, or downloads an artifact. From the CLI you can also run `gitterm sandbox resume <sandboxId>`.

| Provider                            | On pause                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| E2B, Daytona, Vercel, Boat, exe.dev | Files are kept.                                                                        |
| Railway, AWS                        | Files and processes are discarded. Sync again after it resumes. Earlier jobs are gone. |

Direct sandboxes are never paused or resumed.

## Provider notes

**E2B.** E2B deletes the sandbox at its lifetime even while it is busy. Reconnecting cannot extend that deadline.

**Daytona.** Set `snapshot` to start from a Daytona snapshot instead of the default image.

**Vercel.** Previews are always public URLs. Create the sandbox with public previews, approved when the agent asks or by the `publicPreviews` option, or `sandbox_preview` fails. A Vercel sandbox allows five tags, so the purpose and session labels may be dropped.

**Boat.** The base image cannot be replaced. It includes coding agent CLIs (`claude`, `codex`, `opencode`). Gitterm never starts them and gives them no credentials. At its lifetime the sandbox is archived, not deleted, and the storage remains until you destroy it. A file read returns at most 5 MiB, which limits artifacts. Boat has no labels, so the owning account is kept as a hash in the sandbox name.

**exe.dev.** The token needs the `new`, `ls`, `ssh`, `ssh-key`, `pause`, `resume`, and `rm` commands. Each request is limited to 30 seconds and 64 KB, so jobs start detached and large syncs are slow. Previews support ports 3000 to 9999. No labels; the owning account is kept as a hash in the sandbox name.

**Railway.** Railway has no command API, so the sandbox runs a small Gitterm command server. It is not an agent. It accepts requests only with a token derived from your Railway token and the sandbox name. Port 8080 is reserved for it.

**AWS.** Managed only, because it runs on the Gitterm deployment's ECS cluster and load balancer. It uses the same command server as Railway, with a token derived from the deployment's encryption key.

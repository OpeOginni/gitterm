---
title: Plans and billing
description: How plans and compute usage work on managed Gitterm, what each plan includes, and what self-hosted deployments get.
---

This page explains what you pay for on managed Gitterm, how compute is counted, and what each plan allows. Read it when you choose a plan or want to keep usage down. For current prices, see [Pricing](/pricing).

On managed Gitterm you pay for the compute your workspaces and managed sandboxes use. Model usage is billed by your model provider: workspaces run on your own keys, and Gitterm adds no markup.

Self-hosted deployments have no plans or quotas, and every feature is unlocked. See [Self-hosting](/docs/self-hosting/overview).

## How compute is counted

- A usage session runs while a workspace or managed sandbox is running. Pausing ends it.
- Paused time isn't billed as running compute.
- Each machine size has its own hourly rate, so bigger machines use your allowance faster.
- Managed sandboxes count the same way as workspaces. They run at the provider's default machine size, or its smallest on plans limited to the smallest size, and are billed at that size. [Direct sandboxes](/docs/sandboxes/setup) are billed by your own provider account instead.

To keep usage down, let idle workspaces pause and terminate the ones you're done with. See [Lifecycle](/docs/workspaces/lifecycle).

## Plans

|                                              | Free                      | Pro                       | Growth                                                            |
| -------------------------------------------- | ------------------------- | ------------------------- | ----------------------------------------------------------------- |
| Compute                                      | A daily runtime allowance | A monthly compute balance | A larger monthly compute balance, and a discount on extra compute |
| Providers                                    | E2B and Boat              | Every enabled provider    | Every enabled provider                                            |
| Machine sizes                                | Smallest                  | Any                       | Any                                                               |
| Workspaces kept (running, pending or paused) | 2                         | 15                        | 50                                                                |
| Persistent storage where optional            | No                        | Yes                       | Yes                                                               |
| Custom subdomain                             | No                        | Yes                       | Yes                                                               |
| Keep running when idle                       | No                        | Yes                       | Yes                                                               |
| Idle time before pausing                     | 10 minutes                | 30 minutes                | 30 minutes                                                        |
| Paused workspaces kept for                   | 2 days                    | 15 days                   | 30 days                                                           |

Managed sandboxes count toward the workspace limit. A paused workspace is deleted when its retention period ends.

## When compute runs out

- **Free:** when the daily allowance is used up, workspaces pause and can't start again until it resets at midnight UTC.
- **Paid plans:** when the included compute is used up, running workspaces pause and your files are kept. To keep running, turn on pay-as-you-go and set a spend limit. Workspaces pause when that limit is reached.

Spending limits pause workspaces even when **Keep running when idle** is on.

## Manage your plan

Open **Settings → Account** in the dashboard. Under **Usage** and **Plan and billing** you can:

- see your plan, this period's compute use, and the rate of what is running now,
- turn on **Keep running past the included compute** (pay-as-you-go) and set its **Spend limit**,
- upgrade, or click **Manage** to change your subscription and see invoices.

`gitterm auth status` in the CLI and `client.auth.status()` in the SDK also show your plan.

## Related

- [Lifecycle](/docs/workspaces/lifecycle)
- [Cloud workspaces](/docs/workspaces/overview)
- [Sandboxes overview](/docs/sandboxes/overview)

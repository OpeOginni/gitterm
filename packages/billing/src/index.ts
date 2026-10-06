import { getFreeDailyMinuteLimit } from "./free-limit";
import type {
  Billing,
  BillingNotice,
  ComputeUsage,
  Entitlements,
  RunAllowance,
  RunDenialCode,
} from "@gitterm/schema/billing";
import {
  countUsersByPlan,
  deleteAccount,
  getAccount,
  getAccounts,
  listPaidAccounts,
  recordAlerts,
  resolvePeriod,
  setPlan,
  updateSettings,
  type Account,
} from "./accounts";
import { getPlanEntitlements, isPlanId, PLAN_IDS, PLANS, type PlanId } from "./plans";
import { currentPlanTerms, ensurePlanVersion } from "./analytics/plan-versions";
import { recordProductEvent } from "./analytics/product-events";
import { syncUsageIntervals } from "./analytics/usage-intervals";
import { deleteSubject } from "./analytics/subjects";
import { runAnalyticsTasks } from "./analytics/jobs";
import { getReport } from "./analytics/reports";
import { simulatePricing } from "./analytics/simulate";
import { deletePolarCustomer } from "./polar";
import { closeEndedPeriods, recordPeriodOverage, reportUnsettledOverage } from "./overage";
import { getMachinePrices, setMachinePrice } from "./rates";
import { getMinutesUsedToday, getRetailUsage, type RetailUsage } from "./usage";
import { billableOverageCents, MICROS_PER_CENT } from "./money";

/**
 * Running compute reserved when checking balances, so the worker (every ~10
 * minutes) stops workspaces before the balance or spend cap is overshot.
 */
const RESERVE_MINUTES = 15;
const MIN_SPEND_CAP_CENTS = 100;
const MAX_SPEND_CAP_CENTS = 1_000_000;

const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface Standing {
  account: Account;
  period: { start: Date; end: Date };
  compute: ComputeUsage | null;
  dailyMinutes: { used: number; limit: number | null } | null;
  /** Why the user may not run compute now; null when they may. */
  blocked: { code: RunDenialCode; reason: string } | null;
  /** Running compute reserved by the balance check, in cents. */
  reserveCents: number | null;
}

function getComputeUsage(
  account: Account,
  cost: RetailUsage,
  period: { start: Date; end: Date },
  now: Date,
): { usage: ComputeUsage; blocked: Standing["blocked"]; reserveCents: number } {
  const plan = PLANS[account.plan];
  const includedCents = plan.includedComputeCents ?? 0;
  const usedCents = cost.micros / MICROS_PER_CENT;
  const reserveCents = (cost.runningMicrosPerHour * RESERVE_MINUTES) / 60 / MICROS_PER_CENT;
  const overageFor = (cents: number) =>
    Math.max(0, cents - includedCents) * (1 - plan.overageDiscountPercent / 100);
  const payAsYouGo = account.payAsYouGo && account.spendCapCents !== null;

  // Extrapolate from at least a day so the first hours of a period don't spike.
  const elapsedMs = Math.max(now.getTime() - period.start.getTime(), 24 * 60 * 60 * 1000);
  const periodMs = period.end.getTime() - period.start.getTime();

  // `*_reserved`: not used up yet, but would be within the reserved running minutes.
  let blocked: Standing["blocked"] = null;
  if (!payAsYouGo && usedCents + reserveCents >= includedCents) {
    blocked = {
      code: usedCents >= includedCents ? "allowance_exhausted" : "allowance_reserved",
      reason:
        "You've used this period's included compute. Turn on pay-as-you-go in billing settings, or upgrade, to keep running workspaces.",
    };
  } else if (payAsYouGo && overageFor(usedCents + reserveCents) >= account.spendCapCents!) {
    blocked = {
      code:
        overageFor(usedCents) >= account.spendCapCents!
          ? "spend_cap_reached"
          : "spend_cap_reserved",
      reason: `You've reached your ${formatDollars(account.spendCapCents!)} pay-as-you-go limit for this billing period. Raise it in billing settings to keep running workspaces.`,
    };
  }

  return {
    usage: {
      includedCents,
      usedCents: Math.round(usedCents),
      overageCents: billableOverageCents(cost.micros, includedCents, plan.overageDiscountPercent),
      overageDiscountPercent: plan.overageDiscountPercent,
      payAsYouGo,
      spendCapCents: payAsYouGo ? account.spendCapCents : null,
      projectedCents: Math.round((usedCents * periodMs) / Math.min(elapsedMs, periodMs)),
      runningCentsPerHour: Math.round(cost.runningMicrosPerHour / MICROS_PER_CENT),
    },
    blocked,
    reserveCents,
  };
}

async function getStandings(userIds: string[], now = new Date()): Promise<Map<string, Standing>> {
  const accounts = [...(await getAccounts(userIds)).values()];
  const free = accounts.filter((account) => PLANS[account.plan].includedComputeCents === null);
  const paid = accounts.filter((account) => PLANS[account.plan].includedComputeCents !== null);
  const periods = new Map(accounts.map((account) => [account.userId, resolvePeriod(account, now)]));

  const [minutesUsed, dailyLimit, costs] = await Promise.all([
    getMinutesUsedToday(
      free.map((account) => account.userId),
      now,
    ),
    free.length > 0 ? getFreeDailyMinuteLimit() : Promise.resolve(null),
    getRetailUsage(
      paid.map((account) => ({
        userId: account.userId,
        start: periods.get(account.userId)!.start,
      })),
      now,
    ),
  ]);

  const standings = new Map<string, Standing>();
  for (const account of free) {
    const used = minutesUsed.get(account.userId) ?? 0;
    standings.set(account.userId, {
      account,
      period: periods.get(account.userId)!,
      compute: null,
      dailyMinutes: { used, limit: dailyLimit },
      blocked:
        dailyLimit !== null && used >= dailyLimit
          ? {
              code: "daily_runtime_limit",
              reason:
                "Daily cloud runtime limit reached. It resets at midnight UTC, or upgrade for more runtime.",
            }
          : null,
      reserveCents: null,
    });
  }
  for (const account of paid) {
    const period = periods.get(account.userId)!;
    const { usage, blocked, reserveCents } = getComputeUsage(
      account,
      costs.get(account.userId) ?? { micros: 0, runningMicrosPerHour: 0 },
      period,
      now,
    );
    standings.set(account.userId, {
      account,
      period,
      compute: usage,
      dailyMinutes: null,
      blocked,
      reserveCents,
    });
  }
  return standings;
}

/** Policy state recorded with friction events, so a block can be interpreted later. */
function policyOf(standing: Standing) {
  const compute = standing.compute;
  return {
    includedCents: compute?.includedCents ?? null,
    usedCents: compute?.usedCents ?? null,
    reserveCents: standing.reserveCents == null ? null : Math.round(standing.reserveCents),
    overageCents: compute?.overageCents ?? null,
    spendCapCents: compute?.spendCapCents ?? null,
    payAsYouGo: compute?.payAsYouGo ?? null,
  };
}

/** Version id of the terms a plan gives today. */
async function currentPlanVersionId(plan: PlanId): Promise<string> {
  return ensurePlanVersion(
    currentPlanTerms(plan, plan === "free" ? await getFreeDailyMinuteLimit() : null),
  );
}

const INCLUDED_ALERTS = [75, 90, 100] as const;
const CAP_ALERTS = [90, 100] as const;

/** The newest usage alert a user should get, recording every threshold they crossed. */
async function collectNotice(standing: Standing): Promise<BillingNotice | null> {
  const { account, compute, period } = standing;
  if (!compute) return null;
  const alreadySent =
    account.alertsPeriodStart?.getTime() === period.start.getTime() ? account.alertsSent : [];

  const reached = [
    ...INCLUDED_ALERTS.filter(
      (percent) =>
        compute.includedCents > 0 && compute.usedCents >= (compute.includedCents * percent) / 100,
    ).map((percent) => `included-${percent}`),
    ...(compute.spendCapCents
      ? CAP_ALERTS.filter(
          (percent) => compute.overageCents >= (compute.spendCapCents! * percent) / 100,
        ).map((percent) => `cap-${percent}`)
      : []),
  ];
  const fresh = reached.filter((key) => !alreadySent.includes(key));
  if (fresh.length === 0) return null;
  await recordAlerts(account.userId, period.start, [...new Set([...alreadySent, ...reached])]);

  // Crossing a threshold is recorded separately from delivering the email.
  const periodKey = `${account.userId}:${period.start.toISOString()}`;
  const planVersionId = await currentPlanVersionId(account.plan);
  for (const key of fresh) {
    await recordProductEvent({
      userId: account.userId,
      eventType: "alert_threshold_reached",
      reasonCode: key,
      planVersionId,
      policy: policyOf(standing),
      dedupeKey: `alert:${periodKey}:${key}`,
    });
  }

  // Cap alerts outrank balance alerts; within a kind, the highest threshold wins.
  const capAlert = fresh.filter((key) => key.startsWith("cap-")).at(-1);
  const includedAlert = fresh.filter((key) => key.startsWith("included-")).at(-1);
  const key = `${periodKey}:${capAlert ?? includedAlert}`;
  const included = formatDollars(compute.includedCents);
  if (capAlert === "cap-100") {
    return {
      key,
      userId: account.userId,
      subject: "Your GitTerm pay-as-you-go limit is reached",
      message: `Your workspaces have used your ${formatDollars(compute.spendCapCents!)} pay-as-you-go limit for this billing period, so running workspaces are paused and new ones won't start. Raise the limit in billing settings to keep working.`,
    };
  }
  if (capAlert) {
    return {
      key,
      userId: account.userId,
      subject: "You're close to your GitTerm pay-as-you-go limit",
      message: `You've used ${formatDollars(compute.overageCents)} of your ${formatDollars(compute.spendCapCents!)} pay-as-you-go limit this billing period. Workspaces pause when the limit is reached.`,
    };
  }
  if (includedAlert === "included-100") {
    return {
      key,
      userId: account.userId,
      subject: "Your included GitTerm compute is used up",
      message: compute.payAsYouGo
        ? `You've used the ${included} of compute included in your plan. Additional compute is billed at your plan's rates, up to your ${formatDollars(compute.spendCapCents!)} pay-as-you-go limit.`
        : `You've used the ${included} of compute included in your plan, so running workspaces are paused. Turn on pay-as-you-go or upgrade to keep working.`,
    };
  }
  const percent = includedAlert?.replace("included-", "");
  return {
    key,
    userId: account.userId,
    subject: `You've used ${percent}% of your included GitTerm compute`,
    message: `You've used ${formatDollars(compute.usedCents)} of the ${included} of compute included in your plan this billing period.${compute.payAsYouGo ? "" : " Workspaces pause when it runs out unless pay-as-you-go is on."}`,
  };
}

export function createBilling(): Billing {
  return {
    enabled: true,
    plans: PLAN_IDS,

    async getEntitlements(userId) {
      return getPlanEntitlements((await getAccount(userId)).plan);
    },

    async getEntitlementsForUsers(userIds) {
      const accounts = await getAccounts(userIds);
      return new Map<string, Entitlements>(
        [...accounts].map(([userId, account]) => [userId, getPlanEntitlements(account.plan)]),
      );
    },

    async checkRunAllowance(userId, attempt): Promise<RunAllowance> {
      const standing = (await getStandings([userId])).get(userId)!;
      if (!standing.blocked) return { allowed: true };
      // One event per denied attempt; background quota checks don't record.
      if (attempt) {
        await recordProductEvent({
          userId,
          eventType: "run_denied",
          workspaceId: attempt.workspaceId ?? null,
          reasonCode: standing.blocked.code,
          planVersionId: await currentPlanVersionId(standing.account.plan),
          policy: policyOf(standing),
          metadata: {
            action: attempt.action,
            dailyMinutesUsed: standing.dailyMinutes?.used ?? null,
            dailyMinuteLimit: standing.dailyMinutes?.limit ?? null,
          },
        });
      }
      return { allowed: false, ...standing.blocked };
    },

    async getUsersOverAllowance(userIds) {
      const standings = await getStandings(userIds);
      return new Set(
        [...standings].flatMap(([userId, standing]) => (standing.blocked ? [userId] : [])),
      );
    },

    async getAccount(userId) {
      const standing = (await getStandings([userId])).get(userId)!;
      const plan = PLANS[standing.account.plan];
      return {
        plan: standing.account.plan,
        planName: plan.name,
        priceCents: plan.priceCents,
        period: {
          start: standing.period.start.toISOString(),
          end: standing.period.end.toISOString(),
        },
        compute: standing.compute,
        dailyMinutes: standing.dailyMinutes,
      };
    },

    async updateSettings(userId, settings) {
      const account = await getAccount(userId);
      if (PLANS[account.plan].includedComputeCents === null) {
        throw new Error("Pay-as-you-go is only available on paid plans");
      }
      if (settings.payAsYouGo) {
        const cap = settings.spendCapCents;
        if (cap === null || cap < MIN_SPEND_CAP_CENTS || cap > MAX_SPEND_CAP_CENTS) {
          throw new Error(
            `Set a pay-as-you-go limit between ${formatDollars(MIN_SPEND_CAP_CENTS)} and ${formatDollars(MAX_SPEND_CAP_CENTS)}`,
          );
        }
      }
      await updateSettings(
        userId,
        {
          payAsYouGo: settings.payAsYouGo,
          spendCapCents: settings.payAsYouGo ? settings.spendCapCents : null,
        },
        { source: "customer", actor: "customer" },
      );
    },

    getMachinePrices: (machineProfileIds) => getMachinePrices(machineProfileIds),

    async setMachinePrice(machineProfileId, microsPerHour) {
      if (microsPerHour !== null && (!Number.isInteger(microsPerHour) || microsPerHour < 0)) {
        throw new Error("Price must be a whole, non-negative number of millionths of a dollar");
      }
      await setMachinePrice(machineProfileId, microsPerHour);
    },

    async setPlan(userId, plan, options) {
      if (!isPlanId(plan)) throw new Error(`Unknown plan "${plan}"`);
      await setPlan(userId, plan, null, {
        source: "admin",
        actor: "admin",
        // Admin-assigned plans are never evidence of payment.
        category: plan === "free" ? "free" : (options?.category ?? "admin_assigned"),
      });
    },

    countUsersByPlan,

    async onUserDeleted(userId) {
      await deletePolarCustomer(userId);
      // Keep the user's usage as pseudonymous facts before their sessions
      // cascade away; deleting the subject below removes the link to them.
      await syncUsageIntervals({ userId, provenance: "observed" });
      await deleteAccount(userId);
      await deleteSubject(userId);
    },

    async recordObservation(observation) {
      try {
        if (observation.type === "workspace_paused_for_spending") {
          const standing = (await getStandings([observation.userId])).get(observation.userId)!;
          await recordProductEvent({
            userId: observation.userId,
            eventType: "workspace_paused_for_spending",
            workspaceId: observation.workspaceId,
            reasonCode: standing.blocked?.code ?? "allowance_cleared_before_pause",
            planVersionId: await currentPlanVersionId(standing.account.plan),
            policy: policyOf(standing),
          });
        } else if (observation.type === "alert_delivery") {
          await recordProductEvent({
            userId: observation.userId,
            eventType: "alert_delivery",
            outcome: observation.outcome,
            reasonCode: observation.reasonCode ?? null,
            dedupeKey: `delivery:${observation.noticeKey}`,
            metadata: { notice: observation.noticeKey },
          });
        } else {
          await recordProductEvent({
            userId: observation.userId,
            eventType: observation.type,
            workspaceId: observation.workspaceId,
            outcome: observation.outcome,
            reasonCode: observation.reasonCode ?? null,
            latencyMs: observation.latencyMs,
            providerKey: observation.providerKey,
          });
        }
      } catch (error) {
        console.error(`[billing] Failed to record ${observation.type}`, error);
      }
    },

    getReport: (request) => getReport(request),
    simulatePricing: (scenario) => simulatePricing(scenario),

    async runPeriodicTasks() {
      const accounts = await listPaidAccounts();
      const standings = [
        ...(await getStandings(accounts.map((account) => account.userId))).values(),
      ];

      // Overage is earned per period and settled even after pay-as-you-go is
      // turned off or the period ends; unaccepted totals retry next pass.
      await recordPeriodOverage(
        standings.flatMap(({ account, compute, period }) =>
          compute
            ? [
                {
                  userId: account.userId,
                  period,
                  payAsYouGo: compute.payAsYouGo,
                  overageCents: compute.overageCents,
                  includedCents: compute.includedCents,
                  overageDiscountPercent: compute.overageDiscountPercent,
                  spendCapCents: compute.spendCapCents,
                },
              ]
            : [],
        ),
      );
      await closeEndedPeriods();
      try {
        await reportUnsettledOverage();
      } catch (error) {
        console.error("[billing] Failed to report overage to Polar:", error);
      }

      const notices: BillingNotice[] = [];
      for (const standing of standings) {
        const notice = await collectNotice(standing);
        if (notice) notices.push(notice);
      }

      try {
        const analytics = await runAnalyticsTasks();
        console.log(
          `[billing] Analytics: ${analytics.intervals} intervals synced, ${analytics.periods} periods rebuilt, ${analytics.purged} events purged`,
        );
      } catch (error) {
        // Analytics never blocks billing; the next pass catches up from the watermark.
        console.error("[billing] Analytics tasks failed:", error);
      }
      return notices;
    },
  };
}

import { db, eq } from "@gitterm/db";
import { systemConfig } from "@gitterm/db/schema/auth";
import type {
  Billing,
  BillingNotice,
  ComputeUsage,
  Entitlements,
  RunAllowance,
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
import { getPlanEntitlements, isPlanId, PLAN_IDS, PLANS } from "./plans";
import { polarClient, reportOverage } from "./polar";
import { getMachinePrices, setMachinePrice } from "./rates";
import { getComputeCosts, getMinutesUsedToday, type ComputeCost } from "./usage";

const MICROS_PER_CENT = 10_000;
/**
 * Running compute reserved when checking balances, so the worker (every ~10
 * minutes) stops workspaces before the balance or spend cap is overshot.
 */
const RESERVE_MINUTES = 15;
const MIN_SPEND_CAP_CENTS = 100;
const MAX_SPEND_CAP_CENTS = 1_000_000;

const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Free runtime is admin-tunable from the system settings page; 0 means unlimited. */
async function getFreeDailyMinuteLimit(): Promise<number | null> {
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "free_tier_daily_minutes"));
  const configured = row ? Number.parseInt(row.value, 10) : PLANS.free.dailyMinutes;
  return configured && Number.isFinite(configured) && configured > 0 ? configured : null;
}

interface Standing {
  account: Account;
  period: { start: Date; end: Date };
  compute: ComputeUsage | null;
  dailyMinutes: { used: number; limit: number | null } | null;
  /** Why the user may not run compute now; null when they may. */
  blockedReason: string | null;
}

function getComputeUsage(
  account: Account,
  cost: ComputeCost,
  period: { start: Date; end: Date },
  now: Date,
): { usage: ComputeUsage; blockedReason: string | null } {
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

  let blockedReason: string | null = null;
  if (!payAsYouGo && usedCents + reserveCents >= includedCents) {
    blockedReason =
      "You've used this period's included compute. Turn on pay-as-you-go in billing settings, or upgrade, to keep running workspaces.";
  } else if (payAsYouGo && overageFor(usedCents + reserveCents) >= account.spendCapCents!) {
    blockedReason = `You've reached your ${formatDollars(account.spendCapCents!)} pay-as-you-go limit for this billing period. Raise it in billing settings to keep running workspaces.`;
  }

  return {
    usage: {
      includedCents,
      usedCents: Math.round(usedCents),
      overageCents: Math.floor(overageFor(usedCents)),
      overageDiscountPercent: plan.overageDiscountPercent,
      payAsYouGo,
      spendCapCents: payAsYouGo ? account.spendCapCents : null,
      projectedCents: Math.round((usedCents * periodMs) / Math.min(elapsedMs, periodMs)),
      runningCentsPerHour: Math.round(cost.runningMicrosPerHour / MICROS_PER_CENT),
    },
    blockedReason,
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
    getComputeCosts(
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
      blockedReason:
        dailyLimit !== null && used >= dailyLimit
          ? "Daily cloud runtime limit reached. It resets at midnight UTC, or upgrade for more runtime."
          : null,
    });
  }
  for (const account of paid) {
    const period = periods.get(account.userId)!;
    const { usage, blockedReason } = getComputeUsage(
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
      blockedReason,
    });
  }
  return standings;
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

  // Cap alerts outrank balance alerts; within a kind, the highest threshold wins.
  const capAlert = fresh.filter((key) => key.startsWith("cap-")).at(-1);
  const includedAlert = fresh.filter((key) => key.startsWith("included-")).at(-1);
  const included = formatDollars(compute.includedCents);
  if (capAlert === "cap-100") {
    return {
      userId: account.userId,
      subject: "Your GitTerm pay-as-you-go limit is reached",
      message: `Your workspaces have used your ${formatDollars(compute.spendCapCents!)} pay-as-you-go limit for this billing period, so running workspaces are paused and new ones won't start. Raise the limit in billing settings to keep working.`,
    };
  }
  if (capAlert) {
    return {
      userId: account.userId,
      subject: "You're close to your GitTerm pay-as-you-go limit",
      message: `You've used ${formatDollars(compute.overageCents)} of your ${formatDollars(compute.spendCapCents!)} pay-as-you-go limit this billing period. Workspaces pause when the limit is reached.`,
    };
  }
  if (includedAlert === "included-100") {
    return {
      userId: account.userId,
      subject: "Your included GitTerm compute is used up",
      message: compute.payAsYouGo
        ? `You've used the ${included} of compute included in your plan. Additional compute is billed at your plan's rates, up to your ${formatDollars(compute.spendCapCents!)} pay-as-you-go limit.`
        : `You've used the ${included} of compute included in your plan, so running workspaces are paused. Turn on pay-as-you-go or upgrade to keep working.`,
    };
  }
  const percent = includedAlert?.replace("included-", "");
  return {
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

    async checkRunAllowance(userId): Promise<RunAllowance> {
      const reason = (await getStandings([userId])).get(userId)?.blockedReason;
      return reason ? { allowed: false, reason } : { allowed: true };
    },

    async getUsersOverAllowance(userIds) {
      const standings = await getStandings(userIds);
      return new Set(
        [...standings].flatMap(([userId, standing]) => (standing.blockedReason ? [userId] : [])),
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
      await updateSettings(userId, {
        payAsYouGo: settings.payAsYouGo,
        spendCapCents: settings.payAsYouGo ? settings.spendCapCents : null,
      });
    },

    getMachinePrices: (machineProfileIds) => getMachinePrices(machineProfileIds),

    async setMachinePrice(machineProfileId, microsPerHour) {
      if (microsPerHour !== null && (!Number.isInteger(microsPerHour) || microsPerHour < 0)) {
        throw new Error("Price must be a whole, non-negative number of millionths of a dollar");
      }
      await setMachinePrice(machineProfileId, microsPerHour);
    },

    async setPlan(userId, plan) {
      if (!isPlanId(plan)) throw new Error(`Unknown plan "${plan}"`);
      await setPlan(userId, plan);
    },

    countUsersByPlan,

    async onUserDeleted(userId) {
      if (polarClient) {
        try {
          await polarClient.customers.deleteExternal({ externalId: userId });
          console.log(`[polar] Deleted customer for user ${userId}`);
        } catch (error) {
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? Number((error as { statusCode?: number }).statusCode)
              : undefined;
          if (statusCode !== 404) throw error;
          console.warn(`[polar] No customer found for user ${userId}, skipping delete`);
        }
      }
      await deleteAccount(userId);
    },

    async runPeriodicTasks() {
      const accounts = await listPaidAccounts();
      const standings = [
        ...(await getStandings(accounts.map((account) => account.userId))).values(),
      ];

      try {
        await reportOverage(
          standings.flatMap(({ account, compute, period }) =>
            compute?.payAsYouGo && compute.overageCents > 0
              ? [
                  {
                    userId: account.userId,
                    periodStart: period.start,
                    totalCents: compute.overageCents,
                  },
                ]
              : [],
          ),
        );
      } catch (error) {
        // Totals are cumulative, so the next pass reports them again.
        console.error("[billing] Failed to report overage to Polar:", error);
      }

      const notices: BillingNotice[] = [];
      for (const standing of standings) {
        const notice = await collectNotice(standing);
        if (notice) notices.push(notice);
      }
      return notices;
    },
  };
}

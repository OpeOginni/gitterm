"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FolderGit2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Seg } from "@/components/site/seg";
import { trpc } from "@/utils/trpc";
import { initiateCheckout } from "@/lib/auth-client";
import { track } from "@/lib/analytics";
import { useBillingAccount } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { dollars, type ComputeUsage } from "@/components/dashboard/billing-section";
import {
  LineCell,
  LineGrid,
  Panel,
  SectionHeading,
  StatStrip,
  StatusDot,
  type Tone,
} from "@/components/dashboard/kit";
import { SettingsEmpty } from "./settings-page";

const TERMINATED_PAGE_SIZE = 10;

/** Used to suggest Growth when Pro plus pay-as-you-go would cost more. */
const GROWTH_PRICE_CENTS = 20000;
const GROWTH_INCLUDED_CENTS = 25000;
const PRO_PRICE_CENTS = 2500;
const PRO_INCLUDED_CENTS = 2500;
const DAY_MS = 24 * 60 * 60 * 1000;

const BAR_FILL: Record<Tone, string> = {
  ok: "bg-primary",
  busy: "bg-primary",
  paused: "bg-yellow-500 dark:bg-yellow-300",
  warn: "bg-[#fb923c]",
  danger: "bg-destructive",
  muted: "bg-fg-4",
};

function toneFor(percent: number): Tone {
  return percent >= 100 ? "danger" : percent >= 75 ? "warn" : "ok";
}

/** A thin meter. `ahead` shades where the current pace leads by the end of the period. */
function Meter({ percent, ahead, tone }: { percent: number; ahead?: number; tone: Tone }) {
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-fill-2">
      {ahead !== undefined && ahead > percent ? (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-fg-4/40"
          style={{ width: `${Math.min(100, ahead)}%` }}
        />
      ) : null}
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", BAR_FILL[tone])}
        style={{ width: `${Math.min(100, Math.max(percent, percent > 0 ? 1.5 : 0))}%` }}
      />
    </div>
  );
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ─────────────────────────── Paid plans ─────────────────────────────── */

/**
 * Included compute used, how long the period has left, where the current pace leads, and the
 * pay-as-you-go spend against its cap.
 */
function ComputeUsageSummary({
  plan,
  period,
  compute,
}: {
  plan: string;
  period: { start: string; end: string };
  compute: ComputeUsage;
}) {
  const now = Date.now();
  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS));
  const included = Math.max(compute.includedCents, 1);
  const usedPercent = (compute.usedCents / included) * 100;
  const projectedPercent = (compute.projectedCents / included) * 100;

  // When the included compute runs out at the current pace (same one-day floor as billing).
  const rate = compute.usedCents / Math.max(now - start, DAY_MS);
  const runsOutAt =
    rate > 0 && compute.usedCents < compute.includedCents
      ? now + (compute.includedCents - compute.usedCents) / rate
      : null;
  const runsOutSoon = runsOutAt !== null && runsOutAt < end;

  const cap = compute.spendCapCents;
  const capPercent = cap ? (compute.overageCents / Math.max(cap, 1)) * 100 : 0;

  const proBill = PRO_PRICE_CENTS + Math.max(0, compute.projectedCents - PRO_INCLUDED_CENTS);
  const recommendGrowth = plan === "pro" && proBill > GROWTH_PRICE_CENTS;

  return (
    <div className="space-y-4">
      <LineGrid className="grid-cols-2 lg:grid-cols-4">
        <LineCell className="col-span-2 gap-1">
          <span className="text-[12.5px] text-fg-3">Included compute</span>
          <span className="flex items-baseline gap-2">
            <span className="font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg tabular-nums">
              {dollars(compute.usedCents)}
            </span>
            <span className="text-[13.5px] text-fg-3 tabular-nums">
              of {dollars(compute.includedCents)}
            </span>
          </span>
          <div className="mt-2.5">
            <Meter percent={usedPercent} ahead={projectedPercent} tone={toneFor(usedPercent)} />
          </div>
          <span className="mt-1.5 text-[12.5px] text-fg-4 tabular-nums">
            {usedPercent >= 100
              ? "All used"
              : `${Math.round(usedPercent)}% used${runsOutSoon ? `, ${compute.payAsYouGo ? "pay-as-you-go from" : "runs out"} around ${shortDate(new Date(runsOutAt))}` : ""}`}
          </span>
        </LineCell>
        <LineCell className="gap-1">
          <span className="text-[12.5px] text-fg-3">Days left</span>
          <span className="font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg tabular-nums">
            {daysLeft}
          </span>
          <span className="text-[12.5px] text-fg-4">Resets {shortDate(new Date(end))}</span>
        </LineCell>
        <LineCell className="gap-1">
          <span className="text-[12.5px] text-fg-3">Projected</span>
          <span
            className={cn(
              "font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
              projectedPercent > 100 ? "text-[#fb923c]" : "text-fg",
            )}
          >
            {dollars(compute.projectedCents)}
          </span>
          <span className="text-[12.5px] text-fg-4">
            {projectedPercent > 100
              ? `${dollars(compute.projectedCents - compute.includedCents)} past the included`
              : "At your pace this period"}
          </span>
        </LineCell>
        <LineCell className="col-span-2 gap-1">
          <span className="flex items-center gap-2.5 text-[12.5px] text-fg-3">
            Pay-as-you-go
            <StatusDot tone={compute.payAsYouGo ? "ok" : "muted"}>
              {compute.payAsYouGo ? "On" : "Off"}
            </StatusDot>
          </span>
          {compute.payAsYouGo ? (
            <>
              <span className="flex items-baseline gap-2">
                <span className="font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg tabular-nums">
                  {dollars(compute.overageCents)}
                </span>
                {cap !== null ? (
                  <span className="text-[13.5px] text-fg-3 tabular-nums">
                    of {dollars(cap)} cap
                  </span>
                ) : null}
              </span>
              {cap !== null ? (
                <div className="mt-2.5">
                  <Meter percent={capPercent} tone={toneFor(capPercent)} />
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-[13.5px] leading-relaxed text-fg-3">
              Workspaces pause when the included compute runs out.{" "}
              <Link href={"#billing" as Route} className="text-primary hover:underline">
                Turn it on
              </Link>{" "}
              to keep them running.
            </p>
          )}
        </LineCell>
        <LineCell className="col-span-2 gap-1">
          <span className="text-[12.5px] text-fg-3">Running now</span>
          <span className="flex items-baseline gap-2">
            <span className="font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg tabular-nums">
              {dollars(compute.runningCentsPerHour)}
            </span>
            <span className="text-[13.5px] text-fg-3">an hour</span>
          </span>
          <span className="text-[12.5px] text-fg-4">
            {compute.runningCentsPerHour > 0
              ? `About ${dollars(compute.runningCentsPerHour * 24)} a day if left on`
              : "Nothing running"}
          </span>
        </LineCell>
      </LineGrid>

      {recommendGrowth ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-primary/30 px-4 py-3.5 sm:px-5">
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-fg-2">
            At this pace you&apos;ll use about {dollars(compute.projectedCents)} of compute, about{" "}
            {dollars(proBill)} on Pro. Growth covers up to {dollars(GROWTH_INCLUDED_CENTS)} for{" "}
            {dollars(GROWTH_PRICE_CENTS)}.
          </p>
          <Button
            size="sm"
            onClick={() => {
              track("checkout_started", { plan: "growth", source: "settings_usage" });
              void initiateCheckout("growth");
            }}
          >
            Switch to Growth
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Free plan ──────────────────────────────── */

function UsageQuota() {
  const { data, isLoading } = useQuery(trpc.workspace.getDailyUsage.queryOptions());
  if (isLoading) return <Skeleton className="h-[118px] w-full rounded-xl bg-fill" />;

  const usage = data || { minutesUsed: 0, minutesRemaining: 60, dailyLimit: 60 };
  const minutesRemaining = usage.minutesRemaining ?? Infinity;
  const isUnlimited = minutesRemaining === Infinity || usage.dailyLimit === null;

  if (isUnlimited) {
    return (
      <StatStrip
        className="lg:grid-cols-2"
        stats={[
          { label: "Runtime today", value: `${usage.minutesUsed} min` },
          { label: "Daily limit", value: "Unlimited", tone: "busy" },
        ]}
      />
    );
  }

  const percent = usage.dailyLimit ? (usage.minutesUsed / usage.dailyLimit) * 100 : 0;
  const isExhausted = minutesRemaining === 0;
  const isLow = !isExhausted && minutesRemaining < 15;

  return (
    <LineGrid className="grid-cols-2">
      <LineCell className="gap-1">
        <span className="text-[12.5px] text-fg-3">Runtime today</span>
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg tabular-nums">
            {usage.minutesUsed}
          </span>
          <span className="text-[13.5px] text-fg-3">of {usage.dailyLimit} min</span>
        </span>
        <div className="mt-2.5">
          <Meter percent={percent} tone={toneFor(percent)} />
        </div>
      </LineCell>
      <LineCell className="gap-1">
        <span className="text-[12.5px] text-fg-3">Left today</span>
        <span
          className={cn(
            "font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
            isExhausted ? "text-destructive" : isLow ? "text-[#fb923c]" : "text-fg",
          )}
        >
          {minutesRemaining} min
        </span>
        <span className="text-[12.5px] text-fg-4">
          {isExhausted
            ? "Limit reached. Resets at midnight UTC."
            : isLow
              ? "Running low. Wrap up idle workspaces."
              : "Resets at midnight UTC"}
        </span>
      </LineCell>
    </LineGrid>
  );
}

/* ─────────────────────────── Runtime overview ───────────────────────── */

type UsageHistory = {
  days: Array<{ day: string; minutes: number }>;
  workspaces: Array<{
    workspaceId: string;
    name: string;
    provider: string | null;
    sessions: number;
    minutes: number;
    recentMinutes: number;
    lastActiveAt: string;
  }>;
};

/** "45m", "3h 05m", or "128h" once minutes stop mattering. */
function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 100) return `${hours}h`;
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatDay(day: string, style: "short" | "long" = "short"): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(style === "long" ? { weekday: "short" } : {}),
  });
}

/** One bar per UTC day; hover a day for its runtime. */
function RuntimeChart({ days }: { days: UsageHistory["days"] }) {
  const max = Math.max(...days.map((day) => day.minutes), 1);
  const hasData = days.some((day) => day.minutes > 0);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between text-[12.5px] text-fg-4">
        <span className="text-fg-3">Per day</span>
        <span className="font-mono tabular-nums">{hasData ? formatRuntime(max) : ""}</span>
      </div>
      <div
        className="mt-3 flex min-h-32 flex-1 items-end gap-[2px] border-b border-line"
        aria-hidden
      >
        {days.map((day, index) => {
          const edge =
            index < 4
              ? "left-0"
              : index >= days.length - 4
                ? "right-0"
                : "left-1/2 -translate-x-1/2";
          return (
            <div key={day.day} className="group relative flex h-full flex-1 items-end">
              {day.minutes > 0 ? (
                <div
                  className="w-full rounded-t-[3px] bg-primary/70 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(3, (day.minutes / max) * 100)}%` }}
                />
              ) : (
                <div className="h-[2px] w-full bg-fill-2" />
              )}
              <div
                className={`pointer-events-none absolute bottom-full z-10 mb-1.5 hidden rounded-md bg-popover px-2 py-1 text-[12.5px] whitespace-nowrap shadow-[0_6px_18px_rgba(0,0,0,0.35)] group-hover:block ${edge}`}
              >
                <span className="text-fg-3">{formatDay(day.day, "long")}</span>{" "}
                <span className="font-mono text-fg tabular-nums">{formatRuntime(day.minutes)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[12.5px] text-fg-4">
        <span>{formatDay(days[0]!.day)}</span>
        <span>Today, UTC</span>
      </div>
      <table className="sr-only">
        <caption>Runtime per day</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{formatDay(day.day, "long")}</th>
              <td>{formatRuntime(day.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The workspaces that used the most runtime in the window, as shares of the total. */
function RuntimeByWorkspace({ usage, total }: { usage: UsageHistory; total: number }) {
  const top = usage.workspaces
    .filter((entry) => entry.recentMinutes > 0)
    .toSorted((a, b) => b.recentMinutes - a.recentMinutes)
    .slice(0, 5);
  const rest = Math.max(0, total - top.reduce((sum, entry) => sum + entry.recentMinutes, 0));
  const largest = top[0]?.recentMinutes ?? 1;

  return (
    <div>
      <p className="text-[12.5px] text-fg-3">By workspace</p>
      {top.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-fg-4">No runtime yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {top.map((entry) => (
            <li key={entry.workspaceId} className="space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {entry.provider && (
                    <Image
                      src={getIcon(entry.provider)}
                      alt={entry.provider}
                      title={entry.provider}
                      width={14}
                      height={14}
                      className="size-3.5 shrink-0 object-contain"
                    />
                  )}
                  <span className="truncate text-[13.5px] text-fg-2">{entry.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[12.5px] text-fg-2 tabular-nums">
                  {formatRuntime(entry.recentMinutes)}
                  <span className="ml-1.5 text-fg-4">
                    {Math.round((entry.recentMinutes / Math.max(total, 1)) * 100)}%
                  </span>
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-fill-2">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.max(2, (entry.recentMinutes / largest) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="mt-3 text-[12.5px] text-fg-4">
          + {formatRuntime(rest)} across other workspaces
        </p>
      )}
    </div>
  );
}

function RuntimeOverview({ usage }: { usage: UsageHistory | undefined }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        title="Runtime"
        description={`The last ${usage?.days.length ?? 30} days, across every provider.`}
      />
      {usage ? <RuntimeBody usage={usage} /> : <RuntimeSkeleton />}
    </section>
  );
}

function RuntimeSkeleton() {
  return (
    <div className="space-y-4">
      <LineGrid className="grid-cols-3">
        {[0, 1, 2].map((index) => (
          <LineCell key={index} className="gap-2">
            <Skeleton className="h-3.5 w-16 bg-fill-2" />
            <Skeleton className="h-8 w-20 bg-fill-2" />
            <Skeleton className="h-3.5 w-12 bg-fill-2" />
          </LineCell>
        ))}
      </LineGrid>
      <LineGrid className="lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LineCell className="gap-3">
          <Skeleton className="h-3.5 w-14 bg-fill-2" />
          <Skeleton className="min-h-32 w-full flex-1 bg-fill-2" />
        </LineCell>
        <LineCell className="gap-0">
          <Skeleton className="h-3.5 w-24 bg-fill-2" />
          <ul className="mt-3 space-y-3">
            {[0, 1, 2, 3, 4].map((index) => (
              <li key={index} className="space-y-1.5">
                <Skeleton className="h-5 w-full bg-fill-2" />
                <Skeleton className="h-1 w-full bg-fill-2" />
              </li>
            ))}
          </ul>
        </LineCell>
      </LineGrid>
    </div>
  );
}

function RuntimeBody({ usage }: { usage: UsageHistory }) {
  const total = usage.days.reduce((sum, day) => sum + day.minutes, 0);
  const activeDays = usage.days.filter((day) => day.minutes > 0).length;
  const busiest = usage.days.reduce((top, day) => (day.minutes > top.minutes ? day : top));

  return (
    <div className="space-y-4">
      <StatStrip
        className="grid-cols-3 lg:grid-cols-3 max-sm:[&_.font-display]:text-[19px] max-sm:[&_.font-display]:whitespace-nowrap max-sm:[&>div]:px-3.5"
        stats={[
          { label: "Total", value: formatRuntime(total) },
          {
            label: "Active days",
            value: activeDays,
            hint: `of ${usage.days.length}`,
          },
          {
            label: "Busiest day",
            value: busiest.minutes > 0 ? formatRuntime(busiest.minutes) : "None",
            hint: busiest.minutes > 0 ? formatDay(busiest.day, "long") : undefined,
          },
        ]}
      />
      <LineGrid className="lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LineCell className="gap-0">
          <RuntimeChart days={usage.days} />
        </LineCell>
        <LineCell className="gap-0">
          <RuntimeByWorkspace usage={usage} total={total} />
        </LineCell>
      </LineGrid>
    </div>
  );
}

/* ─────────────────────────── Workspace History ─────────────────────── */

export function WorkspaceHistory() {
  const [tab, setTab] = useState<"active" | "terminated">("active");
  const [terminatedPage, setTerminatedPage] = useState(0);

  const { data: activeData, isLoading: isLoadingActive } = useQuery(
    trpc.workspace.listWorkspaces.queryOptions({ status: "active", limit: 50, offset: 0 }),
  );

  const {
    data: terminatedData,
    isLoading: isLoadingTerminated,
    isFetching: isFetchingTerminated,
  } = useQuery({
    ...trpc.workspace.listWorkspaces.queryOptions({
      status: "terminated",
      limit: TERMINATED_PAGE_SIZE,
      offset: terminatedPage * TERMINATED_PAGE_SIZE,
    }),
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });

  const { data: usage } = useQuery(trpc.workspace.getUsageHistory.queryOptions({ days: 30 }));
  const usageByWorkspace = new Map(usage?.workspaces.map((entry) => [entry.workspaceId, entry]));

  const activeWorkspaces = activeData?.workspaces ?? [];
  const terminatedWorkspaces = terminatedData?.workspaces ?? [];
  const terminatedTotal = terminatedData?.pagination.total ?? 0;
  const terminatedHasMore = terminatedData?.pagination.hasMore ?? false;
  const loading = isLoadingActive || isLoadingTerminated;
  const countOf = (total: number) =>
    loading ? null : <span className="text-[12.5px] text-fg-3 tabular-nums">{total}</span>;

  return (
    <div className="space-y-12">
      <RuntimeOverview usage={usage} />
      <section className="space-y-4">
        <SectionHeading
          title="Workspaces"
          action={
            <Seg
              ariaLabel="Workspace status"
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: "active",
                  label: (
                    <>
                      Active
                      {countOf(activeData?.pagination.total ?? activeWorkspaces.length)}
                    </>
                  ),
                },
                {
                  value: "terminated",
                  label: (
                    <>
                      Terminated
                      {countOf(terminatedTotal)}
                    </>
                  ),
                },
              ]}
            />
          }
        />
        {loading ? (
          <WorkspaceListSkeleton />
        ) : tab === "active" ? (
          <WorkspaceList
            workspaces={activeWorkspaces as any[]}
            usage={usageByWorkspace}
            emptyMessage="No active workspaces"
          />
        ) : (
          <div className="space-y-3">
            <WorkspaceList
              workspaces={terminatedWorkspaces as any[]}
              usage={usageByWorkspace}
              emptyMessage="No terminated workspaces"
              muted={isFetchingTerminated}
            />

            {terminatedTotal > TERMINATED_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-[13px] text-fg-3">
                  Page {terminatedPage + 1} of {Math.ceil(terminatedTotal / TERMINATED_PAGE_SIZE)}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={terminatedPage === 0 || isFetchingTerminated}
                    onClick={() => setTerminatedPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!terminatedHasMore || isFetchingTerminated}
                    onClick={() => setTerminatedPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function repoLabelOf(url: string | null | undefined): string | null {
  return url ? url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/i, "") : null;
}

const LIST_COLUMNS = "sm:grid-cols-[minmax(0,1fr)_8rem_4.5rem_11rem]";

function WorkspaceListHeader() {
  return (
    <div
      className={`hidden gap-4 border-b border-line px-5 py-2.5 text-[12.5px] text-fg-3 sm:grid ${LIST_COLUMNS}`}
    >
      <span>Workspace</span>
      <span>Runtime</span>
      <span className="text-right">Sessions</span>
      <span className="text-right">Last active</span>
    </div>
  );
}

/** The table's header over rows shaped like WorkspaceRow. */
function WorkspaceListSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <WorkspaceListHeader />
      <ul className="divide-y divide-line">
        {[0, 1, 2].map((index) => (
          <li
            key={index}
            className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 ${LIST_COLUMNS}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-36 bg-fill-2" />
                <Skeleton className="h-3.5 w-28 bg-fill-2" />
              </div>
            </div>
            <Skeleton className="hidden h-3.5 w-full bg-fill-2 sm:block" />
            <Skeleton className="hidden h-3.5 w-6 justify-self-end bg-fill-2 sm:block" />
            <Skeleton className="hidden h-3.5 w-28 justify-self-end bg-fill-2 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkspaceList({
  workspaces,
  usage,
  emptyMessage,
  muted = false,
}: {
  workspaces: any[];
  usage: Map<string, UsageHistory["workspaces"][number]>;
  emptyMessage: string;
  muted?: boolean;
}) {
  if (workspaces.length === 0) {
    return (
      <Panel className="px-4 py-3 sm:px-5">
        <SettingsEmpty icon={<FolderGit2 />} title={emptyMessage} />
      </Panel>
    );
  }

  // Bars compare workspaces on this page, so the busiest one fills its track.
  const maxMinutes = Math.max(...workspaces.map((ws) => usage.get(ws.id)?.minutes ?? 0), 1);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-line",
        muted && "opacity-60 transition-opacity",
      )}
    >
      <WorkspaceListHeader />
      <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
        {workspaces.map((ws) => (
          <WorkspaceRow key={ws.id} ws={ws} runtime={usage.get(ws.id)} maxMinutes={maxMinutes} />
        ))}
      </ul>
    </div>
  );
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  running: { tone: "ok", label: "Running" },
  pending: { tone: "busy", label: "Starting" },
};

function WorkspaceRow({
  ws,
  runtime,
  maxMinutes,
}: {
  ws: any;
  runtime: UsageHistory["workspaces"][number] | undefined;
  maxMinutes: number;
}) {
  const repoLabel = repoLabelOf(ws.repositoryUrl);
  const minutes = runtime?.minutes ?? 0;
  const live = ws.status === "running" || ws.status === "pending";
  const status = STATUS[ws.status] ?? { tone: "paused" as const, label: "Paused" };
  const lastActive = live
    ? "Running now"
    : ws.pausedAt
      ? `Paused ${formatDistanceToNow(new Date(ws.pausedAt), { addSuffix: true })}`
      : runtime
        ? formatDistanceToNow(new Date(runtime.lastActiveAt), { addSuffix: true })
        : "Never ran";
  const started = `Started ${formatDistanceToNow(new Date(ws.startedAt), { addSuffix: true })}`;

  return (
    <li
      className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-fill sm:px-5 ${LIST_COLUMNS}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
          {ws.cloudProvider?.name ? (
            <Image
              src={getIcon(ws.cloudProvider.name)}
              alt={ws.cloudProvider.name}
              title={ws.cloudProvider.name}
              width={16}
              height={16}
              className="size-4 object-contain"
            />
          ) : (
            <FolderGit2 className="size-4 text-fg-4" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <p className="truncate text-[14px] font-medium text-fg">{ws.name ?? ws.subdomain}</p>
            {ws.status !== "terminated" && (
              <StatusDot tone={status.tone} pulse={ws.status === "pending"} className="shrink-0">
                {status.label}
              </StatusDot>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-3">
            {repoLabel ? (
              <a
                href={ws.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={repoLabel}
                className="truncate font-mono transition-colors hover:text-fg-2"
              >
                {repoLabel}
              </a>
            ) : (
              <span>{ws.cloudProvider?.name ?? "No repository"}</span>
            )}
            {ws.repositoryBranch && (
              <span className="inline-flex min-w-0 items-center gap-1 text-fg-4">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate font-mono">{ws.repositoryBranch}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="hidden sm:block">
        {minutes > 0 ? (
          <p className="font-mono text-[13.5px] text-fg tabular-nums">{formatRuntime(minutes)}</p>
        ) : (
          <p className="text-[12.5px] text-fg-4">{live ? "Starting" : "Never ran"}</p>
        )}
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fill-2">
          {minutes > 0 && (
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.max(4, (minutes / maxMinutes) * 100)}%` }}
            />
          )}
        </div>
      </div>
      <p className="hidden text-right font-mono text-[13.5px] text-fg-2 tabular-nums sm:block">
        {runtime?.sessions ?? 0}
      </p>
      <div className="hidden text-right sm:block">
        <p className={cn("text-[13px]", live ? "text-[#6bd586]" : "text-fg-2")}>{lastActive}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-fg-4">{started}</p>
      </div>

      {/* Phones: one compact meta line instead of columns. */}
      <p className="flex flex-wrap gap-x-2 pl-12 text-[12.5px] text-fg-3 sm:hidden">
        {minutes > 0 && <span className="font-mono text-fg-2">{formatRuntime(minutes)}</span>}
        {runtime && (
          <span>
            {runtime.sessions} {runtime.sessions === 1 ? "session" : "sessions"}
          </span>
        )}
        <span>{lastActive}</span>
      </p>
    </li>
  );
}

/* ─────────────────────────── Public Export ──────────────────────────── */

/** The Account page's usage: monthly compute on paid plans, today's minutes on Free. */
function UsageSkeleton() {
  return (
    <LineGrid className="grid-cols-2 lg:grid-cols-4">
      {["col-span-2", "", "", "col-span-2", "col-span-2"].map((span, index) => (
        <LineCell key={index} className={cn("gap-2", span)}>
          <Skeleton className="h-3.5 w-24 bg-fill-2" />
          <Skeleton className="h-8 w-28 bg-fill-2" />
          <Skeleton className="mt-1 h-3.5 w-40 max-w-full bg-fill-2" />
        </LineCell>
      ))}
    </LineGrid>
  );
}

export function UsageSection() {
  const { data: billing, isLoading } = useBillingAccount();
  const account = billing?.account;
  if (isLoading) return <UsageSkeleton />;
  return account?.compute ? (
    <ComputeUsageSummary plan={account.plan} period={account.period} compute={account.compute} />
  ) : (
    <UsageQuota />
  );
}

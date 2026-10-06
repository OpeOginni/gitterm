"use client";

import { useState } from "react";
import Image from "next/image";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, Clock, FolderGit2, GitBranch, Infinity as InfinityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SettingsEmptyState,
  SettingsSection,
  SettingsSectionBody,
} from "@/components/ui/form-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/utils/trpc";
import { useBillingAccount } from "@/lib/billing";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { ComputeUsageCard } from "@/components/dashboard/billing-section";

const TERMINATED_PAGE_SIZE = 10;
const historyTabsListClassName =
  "inline-flex h-auto w-auto items-center justify-start gap-5 rounded-none border-b border-border/60 bg-transparent p-0";
const historyTabsTriggerClassName =
  "group h-auto flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-0 py-2 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

/* ─────────────────────────── Usage Quota ────────────────────────────── */

function UsageQuota() {
  const { data, isLoading } = useQuery(trpc.workspace.getDailyUsage.queryOptions());
  const usage = data || { minutesUsed: 0, minutesRemaining: 60, dailyLimit: 60 };

  const minutesRemaining = usage.minutesRemaining ?? Infinity;
  const isUnlimited = minutesRemaining === Infinity || usage.dailyLimit === null;

  const percent =
    isUnlimited || !usage.dailyLimit
      ? 0
      : Math.min(100, (usage.minutesUsed / usage.dailyLimit) * 100);
  const isExhausted = !isUnlimited && minutesRemaining === 0;
  const isLow = !isUnlimited && !isExhausted && minutesRemaining < 15;
  const barColor = isExhausted ? "bg-destructive" : isLow ? "bg-amber-500" : "bg-primary";

  return (
    <SettingsSection
      icon={Clock}
      title="Runtime today"
      description="Cloud compute minutes left today. Resets daily at midnight UTC."
    >
      <SettingsSectionBody className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-16 w-full bg-fill" />
        ) : isUnlimited ? (
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold tracking-tight text-white tabular-nums">
              {usage.minutesUsed}
              <span className="text-base font-normal text-fg-4"> min</span>
            </p>
            <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm text-primary">
              <InfinityIcon className="h-4 w-4" />
              Unlimited
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-fill-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="shrink-0 font-mono text-[12px] tabular-nums text-fg-3">
                {usage.minutesRemaining} min left
              </p>
            </div>

            {isExhausted && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Daily limit reached. Your quota will reset at midnight UTC.
              </div>
            )}
            {isLow && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Running low on runtime. Consider wrapping up idle workspaces.
              </div>
            )}
          </>
        )}
      </SettingsSectionBody>
    </SettingsSection>
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

function RuntimeStat({
  label,
  value,
  suffix,
  detail,
}: {
  label: string;
  value: string;
  /** Small text on the value's line, e.g. "of 30". */
  suffix?: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</span>
        {suffix && <span className="text-xs text-fg-4">{suffix}</span>}
      </p>
      {detail && <p className="mt-0.5 truncate text-xs text-fg-4">{detail}</p>}
    </div>
  );
}

/** One bar per UTC day; hover a day for its runtime. */
function RuntimeChart({ days }: { days: UsageHistory["days"] }) {
  const max = Math.max(...days.map((day) => day.minutes), 1);
  const hasData = days.some((day) => day.minutes > 0);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-fg-4">
        <span className="font-mono tabular-nums">{hasData ? formatRuntime(max) : ""}</span>
        <span>per day, UTC</span>
      </div>
      <div className="mt-2 flex h-28 items-end gap-[2px] border-b border-line" aria-hidden>
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
                  className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(3, (day.minutes / max) * 100)}%` }}
                />
              ) : (
                <div className="h-[2px] w-full bg-fill-2" />
              )}
              <div
                className={`pointer-events-none absolute bottom-full z-10 mb-1.5 hidden whitespace-nowrap rounded-md border border-line bg-popover px-2 py-1 text-[11px] shadow-sm group-hover:block ${edge}`}
              >
                <span className="text-fg-3">{formatDay(day.day, "long")}</span>{" "}
                <span className="font-mono text-fg tabular-nums">{formatRuntime(day.minutes)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-4">
        <span>{formatDay(days[0]!.day)}</span>
        <span>Today</span>
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
  if (top.length === 0) return null;
  const rest = Math.max(0, total - top.reduce((sum, entry) => sum + entry.recentMinutes, 0));
  const largest = top[0]!.recentMinutes;

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4">By workspace</p>
      <ul className="mt-3 space-y-2.5">
        {top.map((entry) => (
          <li
            key={entry.workspaceId}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5.5rem] items-center gap-3"
          >
            <span className="flex min-w-0 items-center gap-2">
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
              <span className="truncate text-sm text-fg-2">{entry.name}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-fill-2">
              <span
                className="block h-full rounded-full bg-primary/80"
                style={{ width: `${Math.max(3, (entry.recentMinutes / largest) * 100)}%` }}
              />
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-fg-2">
              {formatRuntime(entry.recentMinutes)}
              <span className="ml-1.5 text-fg-4">
                {Math.round((entry.recentMinutes / Math.max(total, 1)) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="mt-2.5 text-xs text-fg-4">+ {formatRuntime(rest)} across other workspaces</p>
      )}
    </div>
  );
}

function RuntimeOverview({ usage }: { usage: UsageHistory | undefined }) {
  if (!usage) return <Skeleton className="h-64 w-full rounded-2xl bg-fill" />;
  const total = usage.days.reduce((sum, day) => sum + day.minutes, 0);
  const activeDays = usage.days.filter((day) => day.minutes > 0).length;
  const busiest = usage.days.reduce((top, day) => (day.minutes > top.minutes ? day : top));

  return (
    <SettingsSection
      icon={BarChart3}
      title="Runtime"
      description={`Time your cloud workspaces spent running over the last ${usage.days.length} days.`}
    >
      <SettingsSectionBody className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <RuntimeStat label="Total" value={formatRuntime(total)} />
          <RuntimeStat
            label="Active days"
            value={`${activeDays}`}
            suffix={`of ${usage.days.length}`}
          />
          <RuntimeStat
            label="Busiest day"
            value={busiest.minutes > 0 ? formatRuntime(busiest.minutes) : "—"}
            detail={busiest.minutes > 0 ? formatDay(busiest.day, "long") : undefined}
          />
        </div>
        <RuntimeChart days={usage.days} />
        <RuntimeByWorkspace usage={usage} total={total} />
      </SettingsSectionBody>
    </SettingsSection>
  );
}

/* ─────────────────────────── Workspace History ─────────────────────── */

export function WorkspaceHistory() {
  const [tab, setTab] = useState("active");
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

  return (
    <div className="space-y-8">
      <RuntimeOverview usage={usage} />
      {isLoadingActive || isLoadingTerminated ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-fill" />
          <Skeleton className="h-16 w-full bg-fill" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className={historyTabsListClassName}>
            <TabsTrigger value="active" className={historyTabsTriggerClassName}>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground/90 transition-colors group-data-[state=active]:text-foreground">
                  Active
                </span>
                <span className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors group-data-[state=active]:border-foreground/15 group-data-[state=active]:text-foreground/80">
                  {activeData?.pagination.total ?? activeWorkspaces.length}
                </span>
              </div>
            </TabsTrigger>
            <TabsTrigger value="terminated" className={historyTabsTriggerClassName}>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground/90 transition-colors group-data-[state=active]:text-foreground">
                  Terminated
                </span>
              </div>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            <WorkspaceList
              workspaces={activeWorkspaces as any[]}
              usage={usageByWorkspace}
              emptyMessage="No active workspaces"
            />
          </TabsContent>

          <TabsContent value="terminated" className="mt-4 space-y-3">
            <WorkspaceList
              workspaces={terminatedWorkspaces as any[]}
              usage={usageByWorkspace}
              emptyMessage="No terminated workspaces"
              muted={isFetchingTerminated}
            />

            {terminatedTotal > TERMINATED_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  Page {terminatedPage + 1} of {Math.ceil(terminatedTotal / TERMINATED_PAGE_SIZE)}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={terminatedPage === 0 || isFetchingTerminated}
                    onClick={() => setTerminatedPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!terminatedHasMore || isFetchingTerminated}
                    onClick={() => setTerminatedPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function repoLabelOf(url: string | null | undefined): string | null {
  return url ? url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/i, "") : null;
}

const LIST_COLUMNS = "sm:grid-cols-[minmax(0,1fr)_9.5rem_4.5rem_8.5rem]";

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
    return <SettingsEmptyState icon={FolderGit2} title={emptyMessage} />;
  }

  // Bars compare workspaces on this page, so the busiest one fills its track.
  const maxMinutes = Math.max(...workspaces.map((ws) => usage.get(ws.id)?.minutes ?? 0), 1);

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-line bg-card ${muted ? "opacity-60 transition-opacity" : ""}`}
    >
      <div
        className={`hidden gap-4 border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4 sm:grid ${LIST_COLUMNS}`}
      >
        <span>Workspace</span>
        <span>Runtime</span>
        <span className="text-right">Sessions</span>
        <span className="text-right">Last active</span>
      </div>
      <ul className="divide-y divide-line">
        {workspaces.map((ws) => (
          <WorkspaceRow key={ws.id} ws={ws} runtime={usage.get(ws.id)} maxMinutes={maxMinutes} />
        ))}
      </ul>
    </div>
  );
}

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
  const lastActive = live
    ? "Running now"
    : ws.pausedAt
      ? `Paused ${formatDistanceToNow(new Date(ws.pausedAt), { addSuffix: true })}`
      : runtime
        ? formatDistanceToNow(new Date(runtime.lastActiveAt), { addSuffix: true })
        : "—";
  const started = `Started ${formatDistanceToNow(new Date(ws.startedAt), { addSuffix: true })}`;

  return (
    <li
      className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-fill ${LIST_COLUMNS}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-fill">
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
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-fg">{ws.name ?? ws.subdomain}</p>
            {ws.status !== "terminated" && <StatusDot status={ws.status} />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-4">
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
              <span className="inline-flex shrink-0 items-center gap-1 text-fg-3">
                <GitBranch className="size-3" />
                <span className="font-mono">{ws.repositoryBranch}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="hidden sm:block">
        {minutes > 0 ? (
          <p className="font-mono text-sm tabular-nums text-fg">{formatRuntime(minutes)}</p>
        ) : (
          <p className="text-xs text-fg-4">{live ? "Starting…" : "Never ran"}</p>
        )}
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fill-2">
          {minutes > 0 && (
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${Math.max(4, (minutes / maxMinutes) * 100)}%` }}
            />
          )}
        </div>
      </div>
      <p className="hidden text-right font-mono text-sm tabular-nums text-fg-2 sm:block">
        {runtime?.sessions ?? 0}
      </p>
      <div className="hidden text-right sm:block">
        <p className={`text-xs ${live ? "text-emerald-400" : "text-fg-2"}`}>{lastActive}</p>
        <p className="mt-0.5 text-[11px] text-fg-4">{started}</p>
      </div>

      {/* Phones: one compact meta line instead of columns. */}
      <p className="flex flex-wrap gap-x-2 pl-11 text-xs text-fg-4 sm:hidden">
        {minutes > 0 && <span className="font-mono text-fg-2">{formatRuntime(minutes)}</span>}
        {runtime && (
          <span>
            {runtime.sessions} {runtime.sessions === 1 ? "session" : "sessions"}
          </span>
        )}
        <span>{live ? "Running now" : lastActive}</span>
      </p>
    </li>
  );
}

function StatusDot({ status }: { status: string }) {
  const label = status === "running" ? "Running" : status === "pending" ? "Starting" : "Paused";
  const color =
    status === "running" ? "bg-emerald-400" : status === "pending" ? "bg-amber-400" : "bg-fg-4";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-fg-3">
      <span className={`size-1.5 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}

/* ─────────────────────────── Public Export ──────────────────────────── */

export function UsageSection() {
  const { data: billing } = useBillingAccount();
  return billing?.account?.compute ? <ComputeUsageCard /> : <UsageQuota />;
}

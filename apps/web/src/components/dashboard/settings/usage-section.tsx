"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Clock,
  FolderGit2,
  GitBranch,
  Infinity as InfinityIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/utils/trpc";

const TERMINATED_PAGE_SIZE = 8;

/* ─────────────────────────── Usage Quota ────────────────────────────── */

function UsageQuota() {
  const { data, isLoading } = useQuery(trpc.workspace.getDailyUsage.queryOptions());

  if (isLoading) {
    return null;
  }

  const usage = data || { minutesUsed: 0, minutesRemaining: 60, dailyLimit: 60 };

  const isUnlimited =
    usage.minutesRemaining === null ||
    usage.dailyLimit === null ||
    usage.minutesRemaining === Infinity ||
    usage.dailyLimit === Infinity;

  if (isUnlimited) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Runtime today</p>
              <p className="text-3xl font-semibold tracking-tight text-white tabular-nums">
                {usage.minutesUsed} <span className="text-base font-normal text-white/40">min</span>
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm text-primary">
              <InfinityIcon className="h-4 w-4" />
              Unlimited
            </div>
          </div>
          <p className="mt-3 text-xs text-white/30">
            Quota resets daily at midnight UTC.
          </p>
        </CardContent>
      </Card>
    );
  }

  const percent = Math.min(100, (usage.minutesUsed / usage.dailyLimit) * 100);
  const isExhausted = usage.minutesRemaining === 0;
  const isLow = !isExhausted && usage.minutesRemaining < 15;

  // Pick bar color based on quota health
  const barColor = isExhausted
    ? "bg-destructive"
    : isLow
      ? "bg-amber-500"
      : "bg-primary";

  return (
    <Card>
      <CardContent className="py-6 space-y-5">
        {/* Headline row */}
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Runtime today</p>
            <p className="text-3xl font-semibold tracking-tight text-white tabular-nums">
              {usage.minutesUsed}
              <span className="text-base font-normal text-white/40"> / {usage.dailyLimit} min</span>
            </p>
          </div>
          <p className="pb-1 text-sm tabular-nums text-white/50">
            {usage.minutesRemaining} min left
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-white/30">
            Quota resets daily at midnight UTC.
          </p>
        </div>

        {/* Warning banners */}
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
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Workspace History ─────────────────────── */

function WorkspaceHistory() {
  const [terminatedPage, setTerminatedPage] = useState(0);

  const { data: activeData, isLoading: isLoadingActive } = useQuery(
    trpc.workspace.listWorkspaces.queryOptions({ status: "active", limit: 50, offset: 0 }),
  );

  const {
    data: terminatedData,
    isLoading: isLoadingTerminated,
    isFetching: isFetchingTerminated,
  } = useQuery(
    trpc.workspace.listWorkspaces.queryOptions({
      status: "terminated",
      limit: TERMINATED_PAGE_SIZE,
      offset: terminatedPage * TERMINATED_PAGE_SIZE,
    }),
  );

  if (isLoadingActive || isLoadingTerminated) {
    return null;
  }

  const activeWorkspaces = activeData?.workspaces ?? [];
  const terminatedWorkspaces = terminatedData?.workspaces ?? [];
  const terminatedTotal = terminatedData?.pagination.total ?? 0;
  const terminatedHasMore = terminatedData?.pagination.hasMore ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workspace History</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary/30 p-1">
            <TabsTrigger
              value="active"
              className="data-[state=active]:bg-card data-[state=active]:text-foreground"
            >
              Active ({activeData?.pagination.total ?? activeWorkspaces.length})
            </TabsTrigger>
            <TabsTrigger
              value="terminated"
              className="data-[state=active]:bg-card data-[state=active]:text-foreground"
            >
              Terminated ({terminatedTotal})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            <WorkspaceList
              workspaces={activeWorkspaces as any[]}
              emptyMessage="No active workspaces"
            />
          </TabsContent>

          <TabsContent value="terminated" className="mt-4 space-y-3">
            <WorkspaceList
              workspaces={terminatedWorkspaces as any[]}
              emptyMessage="No terminated workspaces"
              muted={isFetchingTerminated}
            />

            {terminatedTotal > TERMINATED_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  Page {terminatedPage + 1} of{" "}
                  {Math.ceil(terminatedTotal / TERMINATED_PAGE_SIZE)}
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
      </CardContent>
    </Card>
  );
}

function WorkspaceList({
  workspaces,
  emptyMessage,
  muted = false,
}: {
  workspaces: any[];
  emptyMessage: string;
  muted?: boolean;
}) {
  if (workspaces.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={muted ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"}>
      {workspaces.map((ws) => {
        const repoLabel = ws.repositoryUrl
          ? ws.repositoryUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/i, "")
          : null;

        return (
          <div
            key={ws.id}
            className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-secondary/20 hover:border-accent/30 transition-colors"
          >
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate">{ws.name ?? ws.subdomain}</p>
                <StatusBadge status={ws.status} />
              </div>

              {(repoLabel || ws.repositoryBranch) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {repoLabel && (
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <FolderGit2 className="h-3 w-3" />
                      {repoLabel}
                    </span>
                  )}
                  {ws.repositoryBranch && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                      <GitBranch className="h-3 w-3" />
                      <span className="font-mono">{ws.repositoryBranch}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground space-y-1 shrink-0 pl-4">
              <div className="flex items-center gap-1.5 justify-end">
                <Clock className="h-3 w-3" />
                <span>
                  Started {formatDistanceToNow(new Date(ws.startedAt), { addSuffix: true })}
                </span>
              </div>
              {ws.stoppedAt && (
                <p>Stopped {formatDistanceToNow(new Date(ws.stoppedAt), { addSuffix: true })}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    running: {
      className: "bg-accent/10 text-accent border-accent/20 hover:bg-accent/20",
      label: "Running",
    },
    pending: {
      className: "bg-secondary text-secondary-foreground border-border/50",
      label: "Pending",
    },
    stopped: {
      className: "bg-secondary text-muted-foreground border-border/50",
      label: "Stopped",
    },
    terminated: {
      className: "bg-destructive/10 text-destructive border-destructive/20",
      label: "Terminated",
    },
  };

  const variant = variants[status] || { className: "", label: status };
  return <Badge className={variant.className}>{variant.label}</Badge>;
}

/* ─────────────────────────── Public Export ──────────────────────────── */

export function UsageSection() {
  return (
    <div className="space-y-6">
      <UsageQuota />
      <WorkspaceHistory />
    </div>
  );
}

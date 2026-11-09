"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, Box, ChevronLeft, ChevronRight, Search, Terminal, X } from "lucide-react";
import { trpc, trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Seg } from "@/components/site/seg";
import { CopyField } from "@/components/dashboard/copy-field";
import { INSTALL_SANDBOX } from "@/lib/site/providers";
import { formatHourlyPrice } from "@/components/dashboard/create-instance/types";
import { WorkspaceRow } from "@/components/dashboard/workspaces/workspace-row";
import { SnapshotsSection } from "@/components/dashboard/workspaces/snapshots-section";
import {
  isLive,
  isSandbox,
  machineProfileOf,
  searchText,
  type CloudProvider,
  type Workspace,
} from "@/components/dashboard/workspaces/workspace-meta";

const FETCH_LIMIT = 100;
const PAGE_SIZE = 8;

type StatusFilter = "all" | "running" | "paused";

const matchesStatus = (workspace: Workspace, filter: StatusFilter) =>
  filter === "all" || (filter === "running" ? isLive(workspace) : workspace.status === "paused");

/**
 * Workspaces (where agents work and you open them) or agent sandboxes (machines your agent or
 * code creates to run commands). Both are workspace rows underneath; each page lists one kind.
 */
export function InstanceList({ kind }: { kind: "agents" | "sandboxes" }) {
  const sandboxes = kind === "sandboxes";
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  // Every active workspace, so search and filters work on the whole set.
  const workspacesQuery = useQuery({
    ...trpc.workspace.listWorkspaces.queryOptions({ status: "active", limit: FETCH_LIMIT }),
    queryFn: async () => {
      const first = await trpcClient.workspace.listWorkspaces.query({
        status: "active",
        limit: FETCH_LIMIT,
      });
      const workspaces = [...first.workspaces];
      while (workspaces.length < first.pagination.total) {
        const next = await trpcClient.workspace.listWorkspaces.query({
          status: "active",
          limit: FETCH_LIMIT,
          offset: workspaces.length,
        });
        if (next.workspaces.length === 0) break;
        workspaces.push(...next.workspaces);
      }
      return { ...first, workspaces };
    },
    // Starting workspaces turn running on their own; check back until they do.
    refetchInterval: (q) =>
      q.state.data?.workspaces.some((w) => w.status === "pending") ? 4000 : false,
  });
  const providersQuery = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  const snapshotsQuery = useQuery(trpc.sandbox.snapshots.queryOptions());

  // The filters and search, shown while loading too so the list doesn't jump when it arrives.
  const toolbar = (counts?: Record<StatusFilter, number>, hourly = 0) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Seg
        ariaLabel="Filter by status"
        value={filter}
        onChange={setFilter}
        fill
        className="sm:inline-flex sm:w-auto"
        options={(["all", "running", "paused"] as const).map((value) => ({
          value,
          label: (
            <span className="inline-flex items-center gap-2 sm:px-2">
              {value === "all" ? "All" : value === "running" ? "Running" : "Paused"}
              <span
                className={cn(
                  "text-[13px] font-normal text-fg-4 tabular-nums",
                  !counts && "invisible",
                )}
              >
                {counts?.[value] ?? 0}
              </span>
            </span>
          ),
        }))}
      />
      <label className="relative flex min-w-0 items-center sm:w-72">
        <Search className="pointer-events-none absolute left-3 size-4 text-fg-4" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!counts}
          placeholder={sandboxes ? "Search by name" : "Search name, repo or agent"}
          aria-label={sandboxes ? "Search agent sandboxes" : "Search workspaces"}
          className="h-12 w-full rounded-[14px] bg-fill pr-9 pl-9 text-[14px] text-fg shadow-[inset_0_0_0_1px_var(--line)] transition-shadow outline-none placeholder:text-fg-4 focus-visible:shadow-[inset_0_0_0_1px_var(--line-2)] disabled:opacity-100 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 rounded-md p-1 text-fg-4 transition-colors hover:bg-fill-2 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </label>
      {hourly > 0 && (
        <p className="text-[13px] text-fg-3 sm:ml-auto" title="What your running workspaces cost">
          Running cost{" "}
          <span className="font-medium text-fg tabular-nums">{formatHourlyPrice(hourly)}</span>
        </p>
      )}
    </div>
  );

  if (workspacesQuery.isLoading || providersQuery.isLoading) {
    return (
      <div className="space-y-8">
        {toolbar()}
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {Array.from({ length: 4 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </ul>
      </div>
    );
  }

  const workspaces = (workspacesQuery.data?.workspaces ?? []).filter(
    (workspace) => isSandbox(workspace) === sandboxes,
  );
  const providers = providersQuery.data?.cloudProviders ?? [];
  const providerOf = (workspace: Workspace) =>
    providers.find((provider) => provider.id === workspace.cloudProviderId);
  const snapshotLabelOf = (workspace: Workspace) =>
    snapshotsQuery.data?.find((snapshot) => snapshot.id === workspace.snapshotId)?.label;

  if (workspaces.length === 0) {
    return sandboxes ? (
      <div className="space-y-12">
        <div className="flex flex-col items-center rounded-xl border border-line px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-fill">
            <Box className="size-[18px] text-fg-3" />
          </span>
          <h2 className="mt-4 font-display text-[18px] font-semibold tracking-[-0.01em] text-fg">
            No agent sandboxes running
          </h2>
          <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-fg-3">
            Add the sandbox plugin to OpenCode and your agent starts one when it needs to run a
            build, tests or a preview. Your own code can start them with the SDK.
          </p>
          <CopyField value={INSTALL_SANDBOX} className="mt-5 w-full max-w-md text-left" />
          <Link
            href={"/docs/sandboxes/overview" as Route}
            className="mt-4 inline-flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg"
          >
            How agent sandboxes work
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <SnapshotsSection workspaces={workspaces} providers={providers} />
      </div>
    ) : (
      <div className="flex flex-col items-center rounded-xl border border-line px-6 py-16 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-fill">
          <Terminal className="size-[18px] text-fg-3" />
        </span>
        <h2 className="mt-4 font-display text-[18px] font-semibold tracking-[-0.01em] text-fg">
          No workspaces yet
        </h2>
        <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-fg-3">
          Start one from a GitHub repo, or from a blank terminal.
        </p>
      </div>
    );
  }

  const counts = {
    all: workspaces.length,
    running: workspaces.filter(isLive).length,
    paused: workspaces.filter((w) => w.status === "paused").length,
  };
  const hourly = workspaces.filter(isLive).reduce((sum, workspace) => {
    if (workspace.hostingType !== "cloud") return sum;
    return sum + (machineProfileOf(workspace, providerOf(workspace))?.priceMicrosPerHour ?? 0);
  }, 0);

  const needle = query.trim().toLowerCase();
  const shown = workspaces.filter(
    (w) => matchesStatus(w, filter) && (!needle || searchText(w).includes(needle)),
  );
  // A new search or filter starts the list on its first page.
  const listKey = `${filter}:${needle}`;

  return (
    <div className="space-y-8">
      {toolbar(counts, hourly)}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line px-6 py-12 text-center">
          <p className="text-[14px] text-fg-3">Nothing matches.</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <WorkspaceSection
          key={listKey}
          workspaces={shown}
          providerOf={providerOf}
          snapshotLabelOf={snapshotLabelOf}
        />
      )}

      {sandboxes && <SnapshotsSection workspaces={workspaces} providers={providers} />}
    </div>
  );
}

/** A workspace row's shape: icon, name and details, then status, main button and chevron. */
function RowSkeleton() {
  return (
    <li className="flex items-center gap-x-5 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
        <div className="min-w-0 flex-1">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-40 max-w-full bg-fill-2" />
          </div>
          <div className="mt-1 flex h-[18px] items-center">
            <Skeleton className="h-3 w-64 max-w-full bg-fill-2" />
          </div>
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <div className="mr-3 w-[156px] space-y-2">
          <Skeleton className="h-3.5 w-16 bg-fill-2" />
          <Skeleton className="h-3 w-28 bg-fill-2" />
        </div>
        <Skeleton className="h-8 w-[148px] rounded-lg bg-fill-2" />
        <div className="size-8" />
      </div>
    </li>
  );
}

function WorkspaceSection({
  workspaces,
  providerOf,
  snapshotLabelOf,
}: {
  workspaces: Workspace[];
  providerOf: (workspace: Workspace) => CloudProvider | undefined;
  snapshotLabelOf: (workspace: Workspace) => string | undefined;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(workspaces.length / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const visible = workspaces.slice(start, start + PAGE_SIZE);

  return (
    <section className="space-y-4">
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {visible.map((workspace) => (
          <WorkspaceRow
            key={workspace.id}
            workspace={workspace}
            provider={providerOf(workspace)}
            snapshotLabel={snapshotLabelOf(workspace)}
          />
        ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-fg-3 tabular-nums">
            {start + 1} to {start + visible.length} of {workspaces.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

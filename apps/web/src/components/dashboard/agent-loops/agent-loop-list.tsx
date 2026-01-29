"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Repeat, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentLoopCard } from "./agent-loop-card";
import type { LoopStatus } from "./types";

const ITEMS_PER_PAGE = 6;

export function AgentLoopList() {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | LoopStatus>("all");

  const loopsQuery = useQuery(
    trpc.agentLoop.listLoops.queryOptions({
      limit: ITEMS_PER_PAGE,
      offset: page * ITEMS_PER_PAGE,
      status: statusFilter,
    }),
  );

  if (loopsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Loading agent loops...</p>
        </div>
      </div>
    );
  }

  const loops = loopsQuery.data?.loops || [];
  const pagination = loopsQuery.data?.pagination;
  const totalPages = pagination ? Math.ceil(pagination.total / ITEMS_PER_PAGE) : 0;

  const handleTabChange = (value: string) => {
    setStatusFilter(value as "all" | LoopStatus);
    setPage(0); // Reset to first page when changing filter
  };

  if (loops.length === 0 && page === 0 && statusFilter === "all") {
    return (
      <div className="flex h-72 flex-col items-center justify-center rounded-xl border-primary/50 border-dashed border bg-card/30 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 ring-1 ring-accent/20">
          <Repeat className="h-7 w-7 text-primary" />
        </div>
        <h3 className="mt-5 text-lg font-medium">No agent loops yet</h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Create a Agentic Loop instance to start autonomous coding tasks from your plan files.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={statusFilter} onValueChange={handleTabChange}>
        <TabsList className="inline-flex h-10 items-center gap-1 rounded-lg bg-muted/30 p-1 backdrop-blur-sm border border-border/40">
          <TabsTrigger
            value="all"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            All
          </TabsTrigger>
          <TabsTrigger
            value="active"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm"
          >
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </TabsTrigger>
          <TabsTrigger
            value="paused"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400 data-[state=active]:shadow-sm"
          >
            Paused
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-sky-500/15 data-[state=active]:text-sky-400 data-[state=active]:shadow-sm"
          >
            Completed
          </TabsTrigger>
          <TabsTrigger
            value="archived"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-zinc-500/15 data-[state=active]:text-zinc-400 data-[state=active]:shadow-sm"
          >
            Archived
          </TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-5">
          {loops.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No {statusFilter === "all" ? "" : statusFilter} loops found.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {loops.map((loop) => (
                <AgentLoopCard key={loop.id} loop={loop} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border/30">
          <p className="text-sm text-muted-foreground">
            Showing {pagination.offset + 1} to{" "}
            {Math.min(pagination.offset + loops.length, pagination.total)} of {pagination.total}{" "}
            loops
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0 || loopsQuery.isFetching}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore || loopsQuery.isFetching}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

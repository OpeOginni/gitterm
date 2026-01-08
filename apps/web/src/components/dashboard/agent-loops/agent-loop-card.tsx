"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  Clock,
  Play,
  Pause,
  Archive,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  FileText,
  Repeat,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { trpc, queryClient } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { RunNextIterationDialog } from "./run-next-iteration-dialog";
import type { AgentLoop, LoopStatus } from "./types";

interface AgentLoopCardProps {
  loop: AgentLoop;
}

export function AgentLoopCard({ loop }: AgentLoopCardProps) {
  const [showRunDialog, setShowRunDialog] = useState(false);

  const pauseMutation = useMutation(
    trpc.agentLoop.pauseLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop paused");
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.listLoops.queryKey() });
      },
      onError: (error) => toast.error(`Failed to pause: ${error.message}`),
    })
  );

  const resumeMutation = useMutation(
    trpc.agentLoop.resumeLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop resumed");
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.listLoops.queryKey() });
      },
      onError: (error) => toast.error(`Failed to resume: ${error.message}`),
    })
  );

  const archiveMutation = useMutation(
    trpc.agentLoop.archiveLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop archived");
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.listLoops.queryKey() });
      },
      onError: (error) => toast.error(`Failed to archive: ${error.message}`),
    })
  );

  const getStatusBadge = (status: LoopStatus) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Active
          </Badge>
        );
      case "paused":
        return (
          <Badge variant="secondary" className="gap-1">
            <Pause className="h-3 w-3" />
            Paused
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20 gap-1">
            <CheckCircle className="h-3 w-3" />
            Completed
          </Badge>
        );
      case "archived":
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Archive className="h-3 w-3" />
            Archived
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const canStartRun = loop.status === "active" && (loop.automationEnabled ? loop.totalRuns === 0 : loop.totalRuns < loop.maxRuns);
  const isLoading = pauseMutation.isPending || resumeMutation.isPending || archiveMutation.isPending;

  return (
    <>
      <RunNextIterationDialog
        open={showRunDialog}
        onOpenChange={setShowRunDialog}
        loop={loop}
      />

      <Card className="group overflow-hidden border-primary/10 bg-card/50 backdrop-blur-sm transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 flex flex-col">
        <CardHeader className="pb-3 px-5 pt-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/50 transition-colors">
                  <Repeat className="h-5 w-5 transition-colors text-primary" />
                </div>
                <div className="flex flex-col min-w-0">
                  <CardTitle className="text-sm font-semibold truncate">
                    {loop.repositoryOwner}/{loop.repositoryName}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {loop.branch}
                  </span>
                </div>
              </div>
              {getStatusBadge(loop.status)}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-4 px-5 flex-1">
          <div className="grid gap-2.5 text-xs text-muted-foreground ml-12">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-mono">{loop.planFilePath}</span>
            </div>
            <div className="flex items-center gap-2">
              <Repeat className="h-3.5 w-3.5 shrink-0" />
              <span>
                {loop.totalRuns} / {loop.maxRuns} runs
                {loop.successfulRuns > 0 && (
                  <span className="text-green-500 ml-1">
                    ({loop.successfulRuns} successful)
                  </span>
                )}
                {loop.failedRuns > 0 && (
                  <span className="text-destructive ml-1">
                    ({loop.failedRuns} failed)
                  </span>
                )}
              </span>
            </div>
            {loop.lastRunAt && (
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Last run {formatDistanceToNow(new Date(loop.lastRunAt), { addSuffix: true })}
                </span>
              </div>
            )}
            {loop.automationEnabled && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="text-amber-500">Automation enabled</span>
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex gap-2 bg-secondary/30 p-4 border-t border-border/50">
          {canStartRun && (
            <Button
              size="sm"
              className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
              onClick={() => setShowRunDialog(true)}
            >
              <Play className="h-3.5 w-3.5" />
              Run Next
            </Button>
          )}

          {loop.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs border-border/50 hover:bg-secondary/50"
              disabled={isLoading}
              onClick={() => pauseMutation.mutate({ loopId: loop.id })}
            >
              {pauseMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
            </Button>
          )}

          {loop.status === "paused" && (
            <Button
              size="sm"
              className="h-9 flex-1 text-xs gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={isLoading}
              onClick={() => resumeMutation.mutate({ loopId: loop.id })}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Resume
            </Button>
          )}

          {loop.status !== "archived" && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 border-border/50 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20"
              disabled={isLoading}
              onClick={() => archiveMutation.mutate({ loopId: loop.id })}
            >
              {archiveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-xs"
            asChild
          >
            <Link href={`/dashboard/loops/${loop.id}`}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}

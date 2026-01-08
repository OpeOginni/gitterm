"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc, queryClient } from "@/utils/trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2,
  ArrowLeft,
  Play,
  Pause,
  Archive,
  CheckCircle,
  XCircle,
  Clock,
  GitBranch,
  FileText,
  GitCommit,
  Repeat,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { RunNextIterationDialog } from "./run-next-iteration-dialog";
import type { AgentLoopRun, RunStatus } from "./types";
import Link from "next/link";

interface AgentLoopDetailProps {
  loopId: string;
}

function LiveDuration({ startedAt }: { startedAt: Date | string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();

    const updateElapsed = () => {
      const now = Date.now();
      const seconds = Math.floor((now - start) / 1000);
      setElapsed(seconds);
    };

    // Update immediately
    updateElapsed();

    // Then update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <span className="text-sm tabular-nums">
      {minutes}m {seconds}s
    </span>
  );
}

export function AgentLoopDetail({ loopId }: AgentLoopDetailProps) {
  const router = useRouter();
  const [showRunDialog, setShowRunDialog] = useState(false);

  const loopQuery = useQuery(trpc.agentLoop.getLoop.queryOptions({ loopId }));

  const pauseMutation = useMutation(
    trpc.agentLoop.pauseLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop paused");
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.getLoop.queryKey({ loopId }) });
      },
      onError: (error) => toast.error(`Failed to pause: ${error.message}`),
    }),
  );

  const resumeMutation = useMutation(
    trpc.agentLoop.resumeLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop resumed");
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.getLoop.queryKey({ loopId }) });
      },
      onError: (error) => toast.error(`Failed to resume: ${error.message}`),
    }),
  );

  const archiveMutation = useMutation(
    trpc.agentLoop.archiveLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop archived");
        router.push("/dashboard/loops");
      },
      onError: (error) => toast.error(`Failed to archive: ${error.message}`),
    }),
  );

  if (loopQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Loading loop details...</p>
        </div>
      </div>
    );
  }

  if (!loopQuery.data?.loop) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">Loop not found</p>
        <Button variant="outline" onClick={() => router.push("/dashboard/loops")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  const loop = loopQuery.data.loop;
  const runs = loop.runs || [];
  const hasOngoingRun = runs.some(
    (run: AgentLoopRun) => run.status === "running" || run.status === "pending",
  );
  const canStartRun = loop.status === "active" && loop.totalRuns < loop.maxRuns && !hasOngoingRun;
  const isLoading =
    pauseMutation.isPending || resumeMutation.isPending || archiveMutation.isPending;

  const getRunStatusBadge = (status: RunStatus) => {
    switch (status) {
      case "running":
        return (
          <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Running
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" />
            Pending
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
            <CheckCircle className="mr-1 h-3 w-3" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/20">
            <XCircle className="mr-1 h-3 w-3" />
            Failed
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Run Dialog */}
      <RunNextIterationDialog open={showRunDialog} onOpenChange={setShowRunDialog} loop={loop} />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard/loops")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {loop.repositoryOwner}/{loop.repositoryName}
            </h2>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              {loop.branch}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loopQuery.refetch()}
            disabled={loopQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${loopQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
          {canStartRun && (
            <Button
              size="sm"
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setShowRunDialog(true)}
            >
              <Play className="h-4 w-4" />
              Run Next Iteration
            </Button>
          )}
          {loop.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => pauseMutation.mutate({ loopId })}
            >
              {pauseMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </Button>
          )}
          {loop.status === "paused" && (
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => resumeMutation.mutate({ loopId })}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
          {loop.status !== "archived" && (
            <Button
              variant="outline"
              size="sm"
              className="hover:text-destructive hover:bg-destructive/10"
              disabled={isLoading}
              onClick={() => archiveMutation.mutate({ loopId })}
            >
              {archiveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="bg-card/50 border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loop.totalRuns} / {loop.maxRuns}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Successful</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{loop.successfulRuns}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{loop.failedRuns}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Plan File</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
              href={`https://github.com/${loop.repositoryOwner}/${loop.repositoryName}/blob/${loop.branch}/${loop.planFilePath}`}
              target="_blank"
              rel="noopener noreferrer"
              title={loop.planFilePath}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono text-sm">{loop.planFilePath}</span>
            </Link>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Progress File
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loop.progressFilePath ? (
              <Link
                className="flex items-center gap-1.5 hover:text-primary transition-colors"
                href={`https://github.com/${loop.repositoryOwner}/${loop.repositoryName}/blob/${loop.branch}/${loop.progressFilePath}`}
                target="_blank"
                rel="noopener noreferrer"
                title={loop.progressFilePath}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-sm">{loop.progressFilePath}</span>
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">No progress file</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Run History */}
      <Card className="bg-card/50 border-primary/10 hover:border-primary/20 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              No runs yet. Start the first iteration to see results here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Commit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run: AgentLoopRun) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono">{run.runNumber}</TableCell>
                    <TableCell>{getRunStatusBadge(run.status)}</TableCell>
                    <TableCell className="font-mono text-xs">{run.model || "-"}</TableCell>
                    <TableCell className="text-sm">
                      {run.startedAt
                        ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })
                        : "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {run.durationSeconds ? (
                        `${Math.floor(run.durationSeconds / 60)}m ${run.durationSeconds % 60}s`
                      ) : run.status === "running" && run.startedAt ? (
                        <LiveDuration startedAt={run.startedAt} />
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {run.commitSha ? (
                        <Link
                          href={`https://github.com/${loop.repositoryOwner}/${loop.repositoryName}/commit/${run.commitSha}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 hover:text-primary transition-colors underline"
                        >
                          <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono text-xs">{run.commitSha.substring(0, 7)}</span>
                        </Link>
                      ) : run.errorMessage ? (
                        <span
                          className="text-xs text-destructive truncate max-w-[200px] block"
                          title={run.errorMessage}
                        >
                          {run.errorMessage}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

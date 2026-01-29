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
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  GitBranch,
  FileText,
  GitCommit,
  Repeat,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/**
 * Maximum time (in minutes) a run can be active before being considered stuck.
 * Must match AGENT_LOOP_RUN_TIMEOUT_MINUTES in packages/api/src/config/agent-loop.ts
 */
const AGENT_LOOP_RUN_TIMEOUT_MINUTES = 40;

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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

  const deleteMutation = useMutation(
    trpc.agentLoop.deleteLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Loop deleted");
        router.push("/dashboard/loops");
      },
      onError: (error) => toast.error(`Failed to delete: ${error.message}`),
    }),
  );

  const restartRunMutation = useMutation(
    trpc.agentLoop.restartRun.mutationOptions({
      onSuccess: () => {
        toast.success("Run restarted");
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.getLoop.queryKey({ loopId }) });
      },
      onError: (error) => toast.error(`Failed to restart run: ${error.message}`),
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
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    archiveMutation.isPending ||
    deleteMutation.isPending;

  // Check if a run is stuck (running/pending for longer than the timeout)
  const isRunStuck = (run: AgentLoopRun): boolean => {
    if (run.status !== "running" && run.status !== "pending") return false;
    if (!run.startedAt) return false;
    const startedAtMs = new Date(run.startedAt).getTime();
    const timeoutMs = AGENT_LOOP_RUN_TIMEOUT_MINUTES * 60 * 1000;
    return Date.now() - startedAtMs > timeoutMs;
  };

  // Find any stalled run
  const stalledRun = runs.find((run: AgentLoopRun) => isRunStuck(run));

  // Find any halted run
  const haltedRun = runs.find((run: AgentLoopRun) => run.status === "halted");

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
      case "halted":
        return (
          <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Halted
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
          {stalledRun && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-destructive border-destructive/50 hover:bg-destructive/10"
              disabled={restartRunMutation.isPending}
              onClick={() => restartRunMutation.mutate({ loopId, runId: stalledRun.id })}
            >
              {restartRunMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Restart Stalled #{stalledRun.runNumber}
            </Button>
          )}
          {haltedRun && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-amber-500 border-amber-500/50 hover:bg-amber-500/10"
              disabled={restartRunMutation.isPending}
              onClick={() => restartRunMutation.mutate({ loopId, runId: haltedRun.id })}
            >
              {restartRunMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Resume Run #{haltedRun.runNumber}
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
          <Button
            variant="outline"
            size="sm"
            className="hover:text-destructive hover:bg-destructive/10"
            disabled={isLoading}
            onClick={() => setShowDeleteDialog(true)}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Loop</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this loop? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate({ loopId });
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Halted Run Alert */}
      {haltedRun && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0">
                <div className="rounded-full bg-amber-500/20 p-2">
                  <Wallet className="h-5 w-5 text-amber-500" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-amber-500 mb-1">
                  Run #{haltedRun.runNumber} is Halted
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {haltedRun.errorMessage ||
                    "This run was halted due to insufficient runs in your account."}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Once you have available runs, you can resume this run to continue from where it
                  stopped.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-amber-500 border-amber-500/50 hover:bg-amber-500/10"
                  disabled={restartRunMutation.isPending}
                  onClick={() => restartRunMutation.mutate({ loopId, runId: haltedRun.id })}
                >
                  {restartRunMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Resume Run #{haltedRun.runNumber}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loop.totalRuns} / {loop.maxRuns}
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Successful</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{loop.successfulRuns}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/10 hover:border-primary/20 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{loop.failedRuns}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/10 hover:border-primary/20 transition-colors">
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
        <Card className="border-primary/10 hover:border-primary/20 transition-colors">
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
      <Card className="border-primary/10 hover:border-primary/20 transition-colors">
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
                    <TableCell className="font-mono text-xs">
                      {run.model?.displayName || "-"}
                    </TableCell>
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
                        <div className="flex flex-col gap-1">
                          <span
                            className={`text-xs truncate max-w-[200px] block ${
                              run.status === "halted" ? "text-amber-500" : "text-destructive"
                            }`}
                            title={run.errorMessage}
                          >
                            {run.errorMessage}
                          </span>
                          {run.status === "halted" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs px-2 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10 w-fit"
                              disabled={restartRunMutation.isPending}
                              onClick={() => restartRunMutation.mutate({ loopId, runId: run.id })}
                            >
                              {restartRunMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <Play className="h-3 w-3 mr-1" />
                              )}
                              Resume
                            </Button>
                          )}
                        </div>
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

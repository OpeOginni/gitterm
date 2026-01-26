"use client";

import { useMemo } from "react";
import { trpc, queryClient } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Play, AlertCircle, Cpu, Bot } from "lucide-react";
import type { AgentLoop } from "./types";

interface RunNextIterationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loop: AgentLoop;
}

export function RunNextIterationDialog({ open, onOpenChange, loop }: RunNextIterationDialogProps) {
  // Fetch credentials to check if user has one for the loop's provider
  const { data: credentialsData, isLoading: credentialsLoading } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );

  const credentials = credentialsData?.credentials ?? [];

  // Find the credential for this loop's provider
  const credentialForProvider = useMemo(() => {
    if (!loop.modelProvider?.name) return null;
    return credentials.find((c) => c.providerName === loop.modelProvider?.name && c.isActive);
  }, [credentials, loop.modelProvider?.name]);

  const hasValidCredential = !!credentialForProvider;
  const isFreeModel = loop.model?.isFree ?? false;
  const canRun = isFreeModel || hasValidCredential;

  const startRunMutation = useMutation(
    trpc.agentLoop.startRun.mutationOptions({
      onSuccess: () => {
        toast.success("Run started successfully!");
        queryClient.invalidateQueries({
          queryKey: trpc.agentLoop.getLoop.queryKey({ loopId: loop.id }),
        });
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.listLoops.queryKey() });
        onOpenChange(false);
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to start run: ${error.message}`);
      },
    }),
  );

  const handleSubmit = async () => {
    if (!canRun) {
      toast.error("No valid API key configured for this provider");
      return;
    }

    try {
      await startRunMutation.mutateAsync({
        loopId: loop.id,
      });
    } catch {
      // Error handling done in mutation callbacks
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] border-border/50 bg-card">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Run Next Iteration
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Start iteration #{loop.totalRuns + 1} for{" "}
            <span className="font-mono text-foreground">
              {loop.repositoryOwner}/{loop.repositoryName}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Model/Provider Info (read-only) */}
          <div className="rounded-lg bg-secondary/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Provider:</span>
              <span className="font-medium">
                {loop.modelProvider?.displayName ?? "Not configured"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Model:</span>
              <span className="font-medium">
                {loop.model?.displayName ?? "Not configured"}
                {isFreeModel && (
                  <span className="ml-2 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                    Free
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Credential Status */}
          {!isFreeModel && (
            <div
              className={`rounded-lg p-3 text-sm ${
                hasValidCredential
                  ? "bg-green-500/10 border border-green-500/20"
                  : "bg-destructive/10 border border-destructive/20"
              }`}
            >
              {credentialsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking credentials...
                </div>
              ) : hasValidCredential ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  API key configured for {loop.modelProvider?.displayName}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  No API key configured for {loop.modelProvider?.displayName ?? "this provider"}.
                  <a href="/dashboard/integrations" className="underline hover:no-underline">
                    Add one
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Run Info */}
          <div className="rounded-lg bg-secondary/30 p-3 text-sm space-y-1">
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Plan file:</span>{" "}
              <span className="font-mono">{loop.planFilePath}</span>
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Branch:</span>{" "}
              <span className="font-mono">{loop.branch}</span>
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Runs:</span> {loop.totalRuns} /{" "}
              {loop.maxRuns}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={startRunMutation.isPending}
            className="border-border/50"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={startRunMutation.isPending || !canRun || credentialsLoading}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {startRunMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Start Run
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

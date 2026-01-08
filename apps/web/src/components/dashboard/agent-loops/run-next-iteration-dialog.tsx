"use client";

import { useState } from "react";
import { trpc, queryClient } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, Key, Cpu } from "lucide-react";
import {
  MODEL_PROVIDERS,
  getModelsForProvider,
  modelRequiresApiKey,
} from "../create-instance/types";
import type { AgentLoop } from "./types";

interface RunNextIterationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loop: AgentLoop;
}

export function RunNextIterationDialog({ open, onOpenChange, loop }: RunNextIterationDialogProps) {
  // Use loop's stored provider/model as defaults, or fall back to first provider
  const defaultProvider = loop.modelProvider || MODEL_PROVIDERS[0]?.id || "";
  const defaultModel =
    loop.model?.split("/")[1] || getModelsForProvider(defaultProvider)[0]?.id || "";

  const [provider, setProvider] = useState(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [apiKey, setApiKey] = useState("");

  const availableModels = getModelsForProvider(provider);
  const requiresApiKey = modelRequiresApiKey(provider, model);

  const startRunMutation = useMutation(
    trpc.agentLoop.startRun.mutationOptions({
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to start run: ${error.message}`);
      },
    }),
  );

  const executeRunMutation = useMutation(
    trpc.agentLoop.executeRun.mutationOptions({
      onSuccess: () => {
        toast.success("Run started successfully!");
        queryClient.invalidateQueries({
          queryKey: trpc.agentLoop.getLoop.queryKey({ loopId: loop.id }),
        });
        queryClient.invalidateQueries({ queryKey: trpc.agentLoop.listLoops.queryKey() });
        onOpenChange(false);
        resetForm();
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to execute run: ${error.message}`);
      },
    }),
  );

  const isSubmitting = startRunMutation.isPending || executeRunMutation.isPending;

  const resetForm = () => {
    setProvider(defaultProvider);
    setModel(defaultModel);
    setApiKey("");
  };

  const handleSubmit = async () => {
    if (requiresApiKey && !apiKey) {
      toast.error("Please enter your API key");
      return;
    }

    try {
      // Step 1: Create a pending run
      const runResult = await startRunMutation.mutateAsync({
        loopId: loop.id,
      });

      if (!runResult.success || !runResult.run) {
        toast.error("Failed to create run");
        return;
      }

      // Step 2: Execute the run with the API key
      const fullModelId = `${provider}/${model}`;
      await executeRunMutation.mutateAsync({
        runId: runResult.run.id,
        provider,
        model: fullModelId,
        apiKey: apiKey,
      });
    } catch (error) {
      // Error handling done in mutation callbacks
    }
  };

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const models = getModelsForProvider(newProvider);
    if (models.length > 0) {
      setModel(models[0].id);
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
          {/* Provider Selection */}
          <div className="grid gap-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              AI Provider
            </Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {MODEL_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model Selection */}
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div className="flex items-center gap-2">
                      {m.name}
                      {!m.requiresApiKey && (
                        <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                          Free
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key Input */}
          {requiresApiKey && (
            <div className="grid gap-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Key className="h-4 w-4 text-muted-foreground" />
                API Key
              </Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="bg-secondary/50 border-border/50 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Your API key is used for this run only and is not stored.
              </p>
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
            disabled={isSubmitting}
            className="border-border/50"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || (requiresApiKey && !apiKey)}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {startRunMutation.isPending ? "Creating run..." : "Executing..."}
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

"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useWorkspaceStatusWatcher } from "@/components/workspace-status-watcher";
import { WorkspaceTypeSelector } from "./workspace-type-selector";
import { CliCommandDisplay } from "./cli-command-display";
import { CreateCloudInstance } from "./create-cloud-instance";
import { CreateLocalInstance } from "./create-local-instance";
import { CreateAgentLoop } from "./create-agent-loop";
import type { WorkspaceType, CreateInstanceResult } from "./types";

const DIALOG_DESCRIPTIONS: Record<WorkspaceType, string> = {
  cloud: "Deploy a new development workspace from a GitHub repository.",
  local: "Create a local tunnel to expose your local development server.",
  "agentic-loops": "Create an autonomous agent that executes tasks from your plan file.",
};

export function CreateInstanceDialog() {
  const [open, setOpen] = useState(false);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>("cloud");
  const [cliCommand, setCliCommand] = useState<string | null>(null);

  const { watchWorkspaceStatus } = useWorkspaceStatusWatcher();

  // Handle success from any form
  const handleSuccess = useCallback(
    (result: CreateInstanceResult) => {
      switch (result.type) {
        case "tunnel":
          setCliCommand(result.command);
          break;
        case "workspace":
          watchWorkspaceStatus({
            workspaceId: result.workspaceId,
            userId: result.userId,
          });
          setOpen(false);
          break;
        case "agent-loop":
          setOpen(false);
          break;
      }
    },
    [watchWorkspaceStatus],
  );

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);

  const handleDialogClose = useCallback(() => {
    setOpen(false);
    setCliCommand(null);
  }, []);

  // Reset CLI command when dialog closes
  useEffect(() => {
    if (!open) {
      setCliCommand(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Instance
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[600px] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Create New Instance</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {DIALOG_DESCRIPTIONS[workspaceType]}
          </DialogDescription>
        </DialogHeader>

        {cliCommand ? (
          <CliCommandDisplay command={cliCommand} onDone={handleDialogClose} />
        ) : (
          <>
            <WorkspaceTypeSelector value={workspaceType} onChange={setWorkspaceType} />

            {workspaceType === "cloud" && (
              <CreateCloudInstance onSuccess={handleSuccess} onCancel={handleCancel} />
            )}

            {workspaceType === "local" && (
              <CreateLocalInstance onSuccess={handleSuccess} onCancel={handleCancel} />
            )}

            {workspaceType === "agentic-loops" && (
              <CreateAgentLoop onSuccess={handleSuccess} onCancel={handleCancel} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

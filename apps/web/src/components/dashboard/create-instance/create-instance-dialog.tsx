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
import { CliCommandDisplay } from "./cli-command-display";
import { CreateCloudInstance } from "./create-cloud-instance";
import { usePrefetchCreateInstanceData } from "./use-prefetch-create-instance-data";
import type { CreateInstanceResult } from "./types";
import { track } from "@/lib/analytics";

const DIALOG_DESCRIPTION = "Deploy a new development workspace from a GitHub repository.";

export function CreateInstanceDialog() {
  const [open, setOpen] = useState(false);
  const [cliCommand, setCliCommand] = useState<string | null>(null);

  const { watchWorkspaceStatus } = useWorkspaceStatusWatcher();

  // Warm the cache so the dialog opens fully populated (no flicker / resize).
  usePrefetchCreateInstanceData();

  // Handle success from any form
  const handleSuccess = useCallback(
    (result: CreateInstanceResult) => {
      switch (result.type) {
        case "workspace":
          watchWorkspaceStatus({
            workspaceId: result.workspaceId,
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

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      track("create_instance_dialog_opened");
    }
    setOpen(nextOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85">
          <Plus className="h-4 w-4" /> New Instance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[90dvh] overflow-y-auto p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white sm:text-xl">
            Create New Instance
          </DialogTitle>
          <DialogDescription className="text-fg-4">{DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        {cliCommand ? (
          <CliCommandDisplay command={cliCommand} onDone={handleDialogClose} />
        ) : (
          <CreateCloudInstance onSuccess={handleSuccess} onCancel={handleCancel} />
        )}
      </DialogContent>
    </Dialog>
  );
}

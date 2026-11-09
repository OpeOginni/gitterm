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

const DIALOG_DESCRIPTION = "Start a cloud workspace for your coding agent.";

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
            provider: result.provider,
            agent: result.agent,
          });
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
    setOpen(nextOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" /> New workspace
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>{DIALOG_DESCRIPTION}</DialogDescription>
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

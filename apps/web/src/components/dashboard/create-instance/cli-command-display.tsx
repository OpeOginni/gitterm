"use client";

import { CopyField } from "@/components/dashboard/copy-field";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

interface CliCommandDisplayProps {
  command: string;
  onDone: () => void;
}

export function CliCommandDisplay({ command, onDone }: CliCommandDisplayProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-3">
        <CopyField label="Run this command to connect" value={command} />
        <p className="text-[13px] text-fg-3">
          Once connected, your local server will be available at the subdomain you chose.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}

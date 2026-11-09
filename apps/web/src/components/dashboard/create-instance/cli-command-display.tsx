"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

interface CliCommandDisplayProps {
  command: string;
  onDone: () => void;
}

export function CliCommandDisplay({ command, onDone }: CliCommandDisplayProps) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-3">
        <Label className="text-[13px] font-medium text-fg-2">Run this command to connect</Label>
        <div className="flex gap-2">
          <Input value={command} readOnly className="font-mono text-[13px]" />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(command);
              toast.success("Copied to clipboard");
            }}
          >
            Copy
          </Button>
        </div>
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

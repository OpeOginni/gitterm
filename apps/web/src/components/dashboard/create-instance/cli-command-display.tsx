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
        <Label className="text-sm font-medium">Run this command to connect:</Label>
        <div className="flex gap-2">
          <Input
            value={command}
            readOnly
            className="font-mono text-sm bg-secondary/50 border-border/50"
          />
          <Button
            variant="outline"
            className="border-border/50 hover:bg-secondary/50"
            onClick={() => {
              navigator.clipboard.writeText(command);
              toast.success("Copied to clipboard");
            }}
          >
            Copy
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Once connected, your local server will be available at the subdomain you chose.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onDone} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup, settingsLabel } from "@/components/dashboard/settings/settings-page";

export function SshKeySection() {
  const { data, isLoading } = useQuery(trpc.user.getSshPublicKey.queryOptions());
  const [publicKey, setPublicKey] = useState("");

  useEffect(() => {
    setPublicKey(data?.publicKey ?? "");
  }, [data?.publicKey]);

  const updateSshKeyMutation = useMutation(
    trpc.user.updateSshPublicKey.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: trpc.user.getSshPublicKey.queryKey() });
        setPublicKey(result.publicKey ?? "");
        toast.success(result.hasPublicKey ? "SSH public key saved" : "SSH public key removed");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const isBusy = isLoading || updateSshKeyMutation.isPending;

  return (
    <SettingsGroup
      title="SSH public key"
      description="Used for editor SSH on Railway and E2B workspaces. Daytona keeps using its native short-lived SSH token flow."
      bodyClassName="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="ssh-public-key" className={settingsLabel}>
          OpenSSH public key
        </Label>
        <Textarea
          id="ssh-public-key"
          placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... you@example.com"
          value={publicKey}
          onChange={(event) => setPublicKey(event.target.value)}
          className="min-h-32 font-mono text-[13px]"
          disabled={isBusy}
        />
      </div>

      <p className="text-[13px] leading-relaxed text-fg-3">
        We only store your public key. Use the same key your editor already trusts (VS Code Remote
        SSH, Cursor, Neovim, etc).
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() => updateSshKeyMutation.mutate({ publicKey: null })}
          disabled={isBusy || !data?.hasPublicKey}
        >
          Remove
        </Button>
        <Button
          onClick={() => updateSshKeyMutation.mutate({ publicKey })}
          disabled={isBusy}
          className="gap-2"
        >
          {updateSshKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save key
        </Button>
      </div>
    </SettingsGroup>
  );
}

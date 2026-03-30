"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          SSH Public Key
        </CardTitle>
        <CardDescription>
          Used for editor access on Railway and E2B workspaces. Daytona continues to use its native short-lived SSH token flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ssh-public-key">OpenSSH public key</Label>
          <Textarea
            id="ssh-public-key"
            placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... you@example.com"
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            className="min-h-28 font-mono text-xs"
            disabled={isLoading || updateSshKeyMutation.isPending}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          We store only your public key. Use the same key you already use locally with VS Code Remote SSH or Neovim.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => updateSshKeyMutation.mutate({ publicKey })}
            disabled={isLoading || updateSshKeyMutation.isPending}
          >
            {updateSshKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save Key
          </Button>
          <Button
            variant="outline"
            onClick={() => updateSshKeyMutation.mutate({ publicKey: null })}
            disabled={isLoading || updateSshKeyMutation.isPending || !data?.hasPublicKey}
          >
            Remove Key
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, KeySquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SettingsEmptyState,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
  SettingsSectionBody,
} from "@/components/ui/form-card";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
] as const;

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiTokensSection() {
  const { data, isLoading } = useQuery(trpc.apiTokens.list.queryOptions());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  // Set after a successful create; the dialog switches to show-once mode.
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const createMutation = useMutation(
    trpc.apiTokens.create.mutationOptions({
      onSuccess: (result) => {
        setCreatedToken(result.token);
        queryClient.invalidateQueries({ queryKey: trpc.apiTokens.list.queryKey() });
      },
      onError: (error) => {
        toast.error(`Failed to create token: ${error.message}`);
      },
    }),
  );

  const revokeMutation = useMutation(
    trpc.apiTokens.revoke.mutationOptions({
      onSuccess: () => {
        toast.success("Token revoked");
        setConfirmingId(null);
        queryClient.invalidateQueries({ queryKey: trpc.apiTokens.list.queryKey() });
      },
      onError: (error) => {
        toast.error(`Failed to revoke token: ${error.message}`);
        setConfirmingId(null);
      },
    }),
  );

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setTokenName("");
      setExpiry("90");
      setCreatedToken(null);
    }
  };

  const handleCreate = () => {
    createMutation.mutate({
      name: tokenName.trim(),
      expiresInDays: expiry === "never" ? null : Number(expiry),
    });
  };

  const handleCopyToken = () => {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken);
    toast.success("Token copied to clipboard");
  };

  const tokens = data?.tokens ?? [];

  return (
    <SettingsSection
      eyebrow="01 / Personal access"
      icon={KeySquare}
      title="API tokens"
      description="Tokens act with your full account permissions and can be revoked here at any time. CLI device-code logins show up in this list too."
      action={
        <Button size="sm" className="gap-2" onClick={() => handleOpenChange(true)}>
          <Plus className="h-4 w-4" />
          New token
        </Button>
      }
    >
      <SettingsSectionBody className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : tokens.length === 0 ? (
          <SettingsEmptyState
            icon={KeySquare}
            title="No API tokens yet"
            description={
              <>
                Create one for the CLI, SDK, or CI, or run{" "}
                <span className="font-mono text-white/55">gitterm login</span> and it will appear
                here.
              </>
            }
            action={
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => handleOpenChange(true)}
              >
                <Plus className="h-4 w-4" />
                Create your first token
              </Button>
            }
          />
        ) : (
          <SettingsRowList>
            {tokens.map((token) => (
              <SettingsRow key={token.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-white/80">{token.name}</span>
                    <span className="font-mono text-[11px] text-white/35">
                      {token.tokenPrefix}…
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
                    Created {formatDate(token.createdAt)} · Expires {formatDate(token.expiresAt)} ·
                    Last used {formatDate(token.lastUsedAt)}
                  </p>
                </div>
                {confirmingId === token.id ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate({ tokenId: token.id })}
                      className="gap-2"
                    >
                      {revokeMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Confirm revoke
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setConfirmingId(token.id)}
                  >
                    Revoke
                  </Button>
                )}
              </SettingsRow>
            ))}
          </SettingsRowList>
        )}

        <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
          <DialogContent>
            {createdToken ? (
              <>
                <DialogHeader>
                  <DialogTitle>Token created</DialogTitle>
                  <DialogDescription>
                    Copy it now. This token won&apos;t be shown again.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-input px-3 py-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-white/80">
                    {createdToken}
                  </code>
                  <Button size="icon" variant="ghost" onClick={handleCopyToken}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => handleOpenChange(false)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>New API token</DialogTitle>
                  <DialogDescription>
                    The token can list, create, and manage your workspaces. It cannot manage other
                    tokens or approve logins.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="api-token-name">Name</Label>
                    <Input
                      id="api-token-name"
                      placeholder="e.g. opencode-plugin, ci"
                      value={tokenName}
                      onChange={(event) => setTokenName(event.target.value)}
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expiration</Label>
                    <Select value={expiry} onValueChange={setExpiry}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!tokenName.trim() || createMutation.isPending}
                    className="gap-2"
                  >
                    {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Create token
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </SettingsSectionBody>
    </SettingsSection>
  );
}

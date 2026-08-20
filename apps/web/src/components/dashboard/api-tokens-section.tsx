"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, Copy, KeyRound, KeySquare, Loader2, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { API_TOKEN_SCOPE_DETAILS, API_TOKEN_SCOPES, type ApiTokenScope } from "@gitterm/schema";
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
  const [scopes, setScopes] = useState<ApiTokenScope[]>([...API_TOKEN_SCOPES]);
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
      setScopes([...API_TOKEN_SCOPES]);
      setCreatedToken(null);
    }
  };

  const handleCreate = () => {
    createMutation.mutate({
      name: tokenName.trim(),
      scopes,
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
      icon={KeySquare}
      title="API tokens"
      description="Tokens are limited to selected SDK permissions and can be revoked here at any time. CLI device-code logins show up in this list too."
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
                  <p className="mt-1 text-[11px] text-white/35">{token.scopes.join(" · ")}</p>
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
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
            {createdToken ? (
              <>
                <DialogHeader>
                  <div className="mb-1 flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <KeyRound className="size-5" />
                  </div>
                  <DialogTitle>Your token is ready</DialogTitle>
                  <DialogDescription>
                    Copy it now and store it somewhere secure. You won&apos;t be able to see it
                    again.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/[0.09] bg-input/70 p-1.5 pl-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
                  <div className="min-w-0">
                    <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-white/35">
                      API token
                    </span>
                    <code
                      className="mt-0.5 block truncate font-mono text-xs text-white/80 selection:bg-primary selection:text-primary-foreground"
                      title={createdToken}
                    >
                      {createdToken}
                    </code>
                  </div>
                  <Button variant="secondary" className="h-10 gap-2" onClick={handleCopyToken}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <DialogFooter className="mt-1">
                  <Button onClick={() => handleOpenChange(false)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>New API token</DialogTitle>
                  <DialogDescription>
                    Select only the SDK permissions this token needs. It cannot manage tokens,
                    integrations, credentials, sharing, or administration.
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
                    <Label>Permissions</Label>
                    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.015] px-1.5">
                      {API_TOKEN_SCOPE_DETAILS.map((detail) => (
                        <label
                          key={detail.scope}
                          className="group flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border-b border-white/[0.06] px-2.5 py-2 text-sm transition-colors last:border-b-0 hover:bg-white/[0.035]"
                        >
                          <Checkbox
                            className="size-[18px] group-hover:border-white/40"
                            checked={scopes.includes(detail.scope)}
                            onCheckedChange={(checked) =>
                              setScopes((current) =>
                                checked
                                  ? [...new Set([...current, detail.scope])]
                                  : current.filter((scope) => scope !== detail.scope),
                              )
                            }
                          />
                          <span className="min-w-0 leading-tight">
                            <span className="block font-medium text-white/80">{detail.label}</span>
                            <span className="mt-1 block text-xs leading-tight text-white/40">
                              {detail.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Expiration</Label>
                    <Select value={expiry} onValueChange={setExpiry}>
                      <SelectTrigger className="h-12 w-full border border-white/[0.08] bg-input/70 px-3.5 hover:border-white/[0.12] hover:bg-input focus-visible:border-primary/35 sm:w-48">
                        <CalendarClock className="size-4 text-primary/80" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" className="border-white/[0.09] bg-surface-2 p-1">
                        {EXPIRY_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="rounded-md py-2.5 pr-9 pl-3 focus:bg-white/[0.06]"
                          >
                            <span className="text-white/85">{option.label}</span>
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
                    disabled={!tokenName.trim() || scopes.length === 0 || createMutation.isPending}
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

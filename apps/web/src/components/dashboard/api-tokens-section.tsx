"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, Copy, KeyRound, KeySquare, Loader2, Plus } from "lucide-react";
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
import { SettingsEmptyState } from "@/components/ui/form-card";

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

function accessSummary(scopes: readonly string[]): string {
  return API_TOKEN_SCOPES.every((scope) => scopes.includes(scope))
    ? "Full API access"
    : `${scopes.length} permission${scopes.length === 1 ? "" : "s"}`;
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
    <section className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">API tokens</h3>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-3">
            Scoped credentials for the SDK, CLI, and automations. Device-code logins also appear
            here.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => handleOpenChange(true)}>
          <Plus className="h-4 w-4" />
          New token
        </Button>
      </header>

      <div>
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
                <span className="font-mono text-fg-3">gitterm login</span> and it will appear here.
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
          <div className="divide-y divide-line">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{token.name}</span>
                    <span className="font-mono text-[11px] text-fg-4">{token.tokenPrefix}…</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
                    <span>
                      {token.lastUsedAt
                        ? `Last used ${formatDate(token.lastUsedAt)}`
                        : "Never used"}
                    </span>
                    <span aria-hidden="true" className="text-fg-4">
                      ·
                    </span>
                    <span>
                      {token.expiresAt ? `Expires ${formatDate(token.expiresAt)}` : "No expiration"}
                    </span>
                    <span aria-hidden="true" className="text-fg-4">
                      ·
                    </span>
                    <span>{accessSummary(token.scopes)}</span>
                  </p>
                  <details className="group mt-2 text-xs text-fg-4">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 transition-colors hover:text-fg-2">
                      Details
                      <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-2 space-y-2 border-l border-line pl-3">
                      <p>Created {formatDate(token.createdAt)}</p>
                      <div>
                        <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-fg-3">
                          Permissions
                        </p>
                        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                          {token.scopes.map((scope) => (
                            <li key={scope} className="font-mono text-[11px] text-fg-2">
                              {scope}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </details>
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
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-settings-dialog sm:max-w-xl">
          {createdToken ? (
            <>
              <DialogHeader>
                <div className="mb-1 flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <KeyRound className="size-5" />
                </div>
                <DialogTitle>Your token is ready</DialogTitle>
                <DialogDescription>
                  Copy it now and store it somewhere secure. You won&apos;t be able to see it again.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line bg-input/70 p-1.5 pl-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
                <div className="min-w-0">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-fg-4">
                    API token
                  </span>
                  <code
                    className="mt-0.5 block truncate font-mono text-xs text-fg selection:bg-primary selection:text-primary-foreground"
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
                  <div className="overflow-hidden rounded-xl border border-line bg-fill px-1.5">
                    {API_TOKEN_SCOPE_DETAILS.map((detail) => (
                      <label
                        key={detail.scope}
                        className="group flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border-b border-line px-2.5 py-2 text-sm transition-colors last:border-b-0 hover:bg-fill"
                      >
                        <Checkbox
                          className="size-[18px] group-hover:border-line-2"
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
                          <span className="block font-medium text-fg">{detail.label}</span>
                          <span className="mt-1 block text-xs leading-tight text-fg-4">
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
                    <SelectTrigger className="h-12 w-full border border-line bg-input/70 px-3.5 hover:border-line-2 hover:bg-input focus-visible:border-primary/35 sm:w-48">
                      <CalendarClock className="size-4 text-primary opacity-80" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" className="border-line bg-surface-2 p-1">
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="rounded-md py-2.5 pr-9 pl-3 focus:bg-fill-2"
                        >
                          <span className="text-fg">{option.label}</span>
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
    </section>
  );
}

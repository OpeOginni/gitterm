"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  Copy,
  Eye,
  KeyRound,
  KeySquare,
  Loader2,
  Plus,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsEmptyState } from "@/components/ui/form-card";
import { BOT_TOKEN_SCOPES } from "@/components/dashboard/bots/config";
import { cn } from "@/lib/utils";

/** Most tokens are one of these; Custom keeps per-permission control for the rest. */
const TOKEN_PRESETS = [
  {
    id: "full",
    icon: Terminal,
    label: "Full access",
    description: "The CLI and your own scripts.",
    scopes: [...API_TOKEN_SCOPES],
  },
  {
    id: "bot",
    icon: Bot,
    label: "Bot",
    description: "Slack and Discord bots: sandboxes and runs.",
    scopes: BOT_TOKEN_SCOPES,
  },
  {
    id: "read",
    icon: Eye,
    label: "Read only",
    description: "Dashboards and monitoring.",
    scopes: API_TOKEN_SCOPES.filter((scope) => scope.endsWith(":read")),
  },
  {
    id: "custom",
    icon: SlidersHorizontal,
    label: "Custom",
    description: "Pick each permission.",
    scopes: null,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  scopes: readonly ApiTokenScope[] | null;
}>;
type PresetId = (typeof TOKEN_PRESETS)[number]["id"];

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
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
  const [preset, setPreset] = useState<PresetId>("full");
  const [customScopes, setCustomScopes] = useState<ApiTokenScope[]>([...API_TOKEN_SCOPES]);
  const scopes = TOKEN_PRESETS.find((entry) => entry.id === preset)?.scopes ?? customScopes;
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
      setPreset("full");
      setCustomScopes([...API_TOKEN_SCOPES]);
      setCreatedToken(null);
    }
  };

  const handleCreate = () => {
    createMutation.mutate({
      name: tokenName.trim(),
      scopes: [...scopes],
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
                <div className="flex items-start gap-3.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <KeySquare className="size-5" />
                  </span>
                  <div className="space-y-1">
                    <DialogTitle>New API token</DialogTitle>
                    <DialogDescription>
                      Pick what it is for. A token can never manage other tokens, model credentials,
                      or administration.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="api-token-name">Name</Label>
                  <Input
                    id="api-token-name"
                    autoFocus
                    placeholder="e.g. ci-deploys, slack-bot"
                    value={tokenName}
                    onChange={(event) => setTokenName(event.target.value)}
                    maxLength={100}
                    className="h-11 font-mono text-[13px] placeholder:font-sans"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label>Access</Label>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4">
                      {scopes.length} of {API_TOKEN_SCOPES.length} permissions
                    </span>
                  </div>
                  <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                    {TOKEN_PRESETS.map((entry) => {
                      const selected = preset === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setPreset(entry.id)}
                          className={cn(
                            "group relative flex items-start gap-3 rounded-xl border p-3 pr-8 text-left transition-colors",
                            selected
                              ? "border-primary/45 bg-primary/[0.06]"
                              : "border-line bg-fill hover:border-line-2 hover:bg-fill-2",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                              selected
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-line bg-fill-2 text-fg-3 group-hover:text-fg-2",
                            )}
                          >
                            <entry.icon className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-fg">{entry.label}</span>
                            <span className="mt-0.5 block text-xs leading-snug text-fg-4">
                              {entry.description}
                            </span>
                          </span>
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute top-3 right-3 flex size-3.5 items-center justify-center rounded-full border transition-colors",
                              selected ? "border-primary" : "border-line-2",
                            )}
                          >
                            {selected ? (
                              <span className="size-1.5 rounded-full bg-primary" />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {preset === "custom" ? (
                    <div className="overflow-hidden rounded-xl border border-line bg-fill px-1.5">
                      {API_TOKEN_SCOPE_DETAILS.map((detail) => (
                        <label
                          key={detail.scope}
                          className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-b border-line px-2.5 py-2 text-sm transition-colors last:border-b-0 hover:bg-fill"
                        >
                          <Checkbox
                            className="size-[18px] group-hover:border-line-2"
                            checked={customScopes.includes(detail.scope)}
                            onCheckedChange={(checked) =>
                              setCustomScopes((current) =>
                                checked
                                  ? [...new Set([...current, detail.scope])]
                                  : current.filter((scope) => scope !== detail.scope),
                              )
                            }
                          />
                          <span className="min-w-0 leading-tight">
                            <span className="block font-medium text-fg">{detail.label}</span>
                            <span className="mt-0.5 block text-xs leading-tight text-fg-4">
                              {detail.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded-md border border-line bg-fill-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-3"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Expires</Label>
                  <div
                    role="radiogroup"
                    className="inline-flex rounded-lg border border-line bg-fill p-0.5"
                  >
                    {EXPIRY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={expiry === option.value}
                        onClick={() => setExpiry(option.value)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                          expiry === option.value
                            ? "bg-fill-2 text-fg shadow-[inset_0_0_0_1px_var(--line-2)]"
                            : "text-fg-4 hover:text-fg-2",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter className="items-center gap-3 sm:justify-between">
                <p className="text-xs text-fg-4">The token is shown once, right after this.</p>
                <div className="flex gap-2">
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
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

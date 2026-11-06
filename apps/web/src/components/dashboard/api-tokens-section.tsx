"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Braces,
  CalendarClock,
  ChevronDown,
  Clock,
  Copy,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { API_TOKEN_SCOPE_DETAILS, API_TOKEN_SCOPES, type ApiTokenScope } from "@gitterm/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { BOT_TOKEN_SCOPES } from "@gitterm/schema";
import { cn } from "@/lib/utils";
import { Seg } from "@/components/site/seg";
import {
  SettingsEmpty,
  SettingsGroup,
  settingsLabel,
} from "@/components/dashboard/settings/settings-page";

/** Most tokens are one of these; Custom keeps per-permission control for the rest. */
const TOKEN_PRESETS = [
  {
    id: "full",
    label: "Full access",
    description: "The CLI and your scripts",
    scopes: [...API_TOKEN_SCOPES],
  },
  {
    id: "bot",
    label: "Bot",
    description: "Slack and Discord bots",
    scopes: BOT_TOKEN_SCOPES,
  },
  {
    id: "read",
    label: "Read only",
    description: "Dashboards and monitoring",
    scopes: API_TOKEN_SCOPES.filter((scope) => scope.endsWith(":read")),
  },
  {
    id: "custom",
    label: "Custom",
    description: "Choose permissions",
    scopes: null,
  },
] as const satisfies ReadonlyArray<{
  id: string;
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
  const [scopesOpenId, setScopesOpenId] = useState<string | null>(null);
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
    <section>
      <SettingsGroup
        title={
          <>
            Tokens
            {tokens.length ? (
              <span className="ml-2 font-normal text-fg-3 tabular-nums">{tokens.length}</span>
            ) : null}
          </>
        }
        action={
          <Button className="gap-1.5" onClick={() => handleOpenChange(true)}>
            <Plus className="size-4" />
            New token
          </Button>
        }
        bodyClassName="pt-2"
      >
        {isLoading ? (
          <div className="space-y-2 pt-2">
            <Skeleton className="h-12 w-full bg-fill" />
            <Skeleton className="h-12 w-full bg-fill" />
          </div>
        ) : tokens.length === 0 ? (
          <SettingsEmpty
            icon={<Braces />}
            title="No tokens yet"
            description={
              <>
                Create one for the CLI, SDK, or CI, or run{" "}
                <span className="font-mono text-fg-2">gitterm login</span>.
              </>
            }
          />
        ) : (
          <div className="-mx-5 max-h-[640px] divide-y divide-line overflow-y-auto sm:-mx-6">
            {tokens.map((token) => (
              <div key={token.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fill">
                  {token.bot ? (
                    <Image src={`/${token.bot.platform}.svg`} alt="" width={16} height={16} />
                  ) : (
                    <Braces className="size-4 text-fg-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-fg">{token.name}</span>
                    <span className="font-mono text-[12.5px] text-fg-4">{token.tokenPrefix}…</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-3">
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5" />
                      {token.lastUsedAt ? `Used ${formatDate(token.lastUsedAt)}` : "Never used"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CalendarClock className="size-3.5" />
                      {token.expiresAt ? `Expires ${formatDate(token.expiresAt)}` : "No expiry"}
                    </span>
                    <button
                      type="button"
                      aria-expanded={scopesOpenId === token.id}
                      onClick={() => setScopesOpenId((id) => (id === token.id ? null : token.id))}
                      className="group flex items-center gap-1.5 transition-colors hover:text-fg"
                    >
                      <ShieldCheck className="size-3.5" />
                      {accessSummary(token.scopes)}
                      <ChevronDown className="size-3 transition-transform group-aria-expanded:rotate-180" />
                    </button>
                    {token.bot ? (
                      <Link
                        href={`/dashboard/bots/${token.bot.id}` as Route}
                        className="flex items-center gap-1 text-fg-2 transition-colors hover:text-fg"
                      >
                        Open bot
                        <ArrowRight className="size-3" />
                      </Link>
                    ) : null}
                  </div>
                  {/* Under the whole line, so nothing beside the toggle moves. */}
                  {scopesOpenId === token.id ? (
                    <p className="mt-1.5 font-mono text-[12.5px] leading-relaxed text-fg-3">
                      {token.scopes.join(" · ")}
                      <span className="text-fg-4"> · created {formatDate(token.createdAt)}</span>
                    </p>
                  ) : null}
                </div>
                {confirmingId === token.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate({ tokenId: token.id })}
                      className="gap-1.5"
                    >
                      {revokeMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      Revoke
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirmingId(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
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
      </SettingsGroup>

      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto border-line bg-card p-0 sm:max-w-[560px]">
          {createdToken ? (
            <>
              <DialogHeader className="px-5 pt-5 pb-4 text-left">
                <DialogTitle>Your token is ready</DialogTitle>
                <DialogDescription>Copy it now. It won&apos;t be shown again.</DialogDescription>
              </DialogHeader>
              <div className="px-5 pb-5">
                <button
                  type="button"
                  onClick={handleCopyToken}
                  className="group relative w-full rounded-xl bg-fill px-3.5 py-3 text-left transition-colors hover:bg-fill-2"
                >
                  <code
                    className="block truncate pr-7 font-mono text-sm text-fg selection:bg-primary selection:text-primary-foreground"
                    title={createdToken}
                  >
                    {createdToken}
                  </code>
                  <Copy className="absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2 text-fg-4 transition-colors group-hover:text-fg" />
                </button>
              </div>
              <div className="flex gap-2 border-t border-line p-4">
                <Button
                  variant="secondary"
                  className="h-10 flex-1 text-sm"
                  onClick={handleCopyToken}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
                <Button className="h-10 flex-1 text-sm" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="px-5 pt-5 pb-4 text-left">
                <DialogTitle>New API token</DialogTitle>
                <DialogDescription>
                  Tokens can never manage other tokens, model credentials, or administration.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 px-5 pb-5">
                <div className="space-y-2">
                  <label htmlFor="api-token-name" className={settingsLabel}>
                    Name
                  </label>
                  <Input
                    id="api-token-name"
                    autoFocus
                    placeholder="ci-deploys"
                    value={tokenName}
                    onChange={(event) => setTokenName(event.target.value)}
                    maxLength={100}
                    className="h-11 font-mono text-sm placeholder:text-fg-4"
                  />
                </div>

                <div className="space-y-2">
                  <p className={settingsLabel}>Access</p>
                  <div role="radiogroup" className="divide-y divide-line rounded-xl bg-fill">
                    {TOKEN_PRESETS.map((entry) => {
                      const selected = preset === entry.id;
                      return (
                        <div key={entry.id}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setPreset(entry.id)}
                            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-fill"
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                                selected ? "border-primary" : "border-line-2",
                              )}
                            >
                              {selected ? (
                                <span className="size-1.5 rounded-full bg-primary" />
                              ) : null}
                            </span>
                            <span className={cn("text-[15px]", selected ? "text-fg" : "text-fg-2")}>
                              {entry.label}
                            </span>
                            <span className="ml-auto truncate text-[13px] text-fg-3">
                              {entry.description}
                            </span>
                          </button>
                          {entry.id === "custom" && selected ? (
                            <div className="grid gap-1 px-3.5 pb-3 pl-10 sm:grid-cols-2">
                              {API_TOKEN_SCOPE_DETAILS.map((detail) => (
                                <label
                                  key={detail.scope}
                                  title={detail.description}
                                  className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-fg-3 hover:text-fg"
                                >
                                  <Checkbox
                                    className="size-3.5"
                                    checked={customScopes.includes(detail.scope)}
                                    onCheckedChange={(checked) =>
                                      setCustomScopes((current) =>
                                        checked
                                          ? [...new Set([...current, detail.scope])]
                                          : current.filter((scope) => scope !== detail.scope),
                                      )
                                    }
                                  />
                                  {detail.label}
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <p className="font-mono text-[12.5px] leading-relaxed text-fg-3">
                    {scopes.length ? scopes.join(" · ") : "No permissions selected"}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className={settingsLabel}>Expires</p>
                  <Seg
                    ariaLabel="Expires"
                    fill
                    value={expiry}
                    onChange={setExpiry}
                    options={EXPIRY_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                </div>
              </div>

              <div className="flex gap-2 border-t border-line p-4">
                <Button
                  variant="secondary"
                  className="h-10 text-sm"
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!tokenName.trim() || scopes.length === 0 || createMutation.isPending}
                  className="h-10 flex-1 gap-2 text-sm"
                >
                  {createMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Create token
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

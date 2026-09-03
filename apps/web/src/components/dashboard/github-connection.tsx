"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { GitHub as Github } from "@/components/logos/Github";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { queryClient, trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";

const GITHUB_APP_NAME = env.NEXT_PUBLIC_GITHUB_APP_NAME || "gitterm-dev";

async function copyIntegrationId(integrationId: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(integrationId);
    toast.success("Integration ID copied");
    return true;
  } catch {
    toast.error("Couldn't copy the integration ID");
    return false;
  }
}

type Installation = {
  id: string;
  integrationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  installedAt: Date | string;
  suspended: boolean;
};

function StatusIndicator({ suspended }: { suspended: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em]",
        suspended ? "text-red-300" : "text-emerald-300",
      )}
    >
      <span className={cn("size-1.5 rounded-full", suspended ? "bg-red-400" : "bg-emerald-400")} />
      {suspended ? "Suspended" : "Connected"}
    </span>
  );
}

function ProfileDetail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof GitBranch;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.19em] text-fg-4">
        <Icon className="size-3" />
        {label}
      </span>
      <div className="truncate text-[13px] text-fg-2">{children}</div>
    </div>
  );
}

function GitHubProfileCard({
  installation,
  isDisconnecting,
  onCopy,
  onDisconnect,
}: {
  installation: Installation;
  isDisconnecting: boolean;
  onCopy: (id: string) => Promise<boolean>;
  onDisconnect: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    },
    [],
  );

  async function handleCopy() {
    if (!(await onCopy(installation.integrationId))) return;

    setCopied(true);
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <article className="rounded-xl border border-line bg-settings p-4 transition-colors hover:border-line-2 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <Image
            src={`https://github.com/${installation.accountLogin}.png`}
            alt={`${installation.accountLogin} GitHub profile`}
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold tracking-tight text-fg">
                @{installation.accountLogin}
              </h3>
              <StatusIndicator suspended={installation.suspended} />
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-4">
              GitHub {installation.accountType}
            </p>
          </div>
        </div>

        <a
          href={`https://github.com/settings/installations/${installation.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.13em] text-fg-3 transition-colors hover:text-fg"
        >
          Manage
          <ExternalLink className="size-3" />
        </a>
      </div>

      {installation.suspended ? (
        <div className="mt-4 flex items-start gap-2.5 text-red-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-300" />
          <p className="text-xs leading-relaxed">
            Git operations are paused. Resolve this installation on GitHub to reconnect it.
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 sm:gap-8">
        <div>
          <ProfileDetail icon={GitBranch} label="Repository access">
            {installation.repositorySelection === "all"
              ? "All repositories"
              : "Selected repositories"}
          </ProfileDetail>
        </div>
        <div>
          <ProfileDetail icon={CalendarDays} label="Connected">
            {new Date(installation.installedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </ProfileDetail>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Integration ID copied" : "Copy integration ID"}
          className="inline-flex h-8 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.13em] text-fg-3 transition-colors hover:text-fg"
        >
          <span className="relative size-3.5" aria-hidden="true">
            <Copy
              className={cn(
                "absolute inset-0 size-3.5 transition-all duration-200 motion-reduce:transition-none",
                copied ? "scale-50 rotate-12 opacity-0" : "scale-100 rotate-0 opacity-100",
              )}
            />
            <Check
              className={cn(
                "absolute inset-0 size-3.5 text-emerald-300 transition-all duration-200 motion-reduce:transition-none",
                copied ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-12 opacity-0",
              )}
            />
          </span>
          <span className="relative grid overflow-hidden">
            <span
              className={cn(
                "col-start-1 row-start-1 transition-all duration-200 motion-reduce:transition-none",
                copied ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100",
              )}
            >
              Copy integration ID
            </span>
            <span
              aria-live="polite"
              className={cn(
                "col-start-1 row-start-1 text-emerald-300 transition-all duration-200 motion-reduce:transition-none",
                copied ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
              )}
            >
              Copied
            </span>
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDisconnect(installation.integrationId)}
          disabled={isDisconnecting}
          className="ml-auto h-8 gap-1.5 px-0 font-mono text-[10px] uppercase tracking-[0.13em] text-fg-4 hover:bg-transparent hover:text-red-300"
        >
          {isDisconnecting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          Disconnect
        </Button>
      </div>
    </article>
  );
}

export function GitHubConnection() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery(trpc.github.getInstallationStatus.queryOptions());
  const disconnectMutation = useMutation(trpc.github.disconnectApp.mutationOptions());
  const installations = data?.installations ?? [];

  function handleConnect() {
    track("github_connected");
    setIsConnecting(true);
    const redirectUrl = `${env.NEXT_PUBLIC_SERVER_URL}/api/github/callback`;
    window.location.href = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?redirect_uri=${encodeURIComponent(redirectUrl)}`;
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success("GitHub connections refreshed");
    } catch {
      toast.error("Couldn't refresh GitHub connections");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDisconnect(integrationId: string) {
    setDisconnectingId(integrationId);
    try {
      await disconnectMutation.mutateAsync({ integrationId });
      track("github_disconnected");
      toast.success("Disconnect requested. It takes effect shortly.");
      await queryClient.invalidateQueries({
        queryKey: trpc.github.getInstallationStatus.queryKey(),
      });
    } catch {
      toast.error("Couldn't disconnect this GitHub account");
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Github className="size-7 shrink-0 text-fg" fill="currentColor" />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight text-fg">GitHub</h2>
              {installations.length > 0 ? (
                <span className="font-mono text-[10px] text-fg-4">
                  {installations.length} {installations.length === 1 ? "account" : "accounts"}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Secure repository access for your workspaces.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {installations.length > 0 ? (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Refresh GitHub connections"
              className="inline-flex size-9 items-center justify-center rounded-lg text-fg-4 transition-colors hover:bg-fill-2 hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting}
            className="h-9 gap-1.5 bg-primary px-3.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary/90"
          >
            {isConnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {installations.length > 0 ? "Add account" : "Connect"}
          </Button>
        </div>
      </header>

      <div>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-fg-4" />
          </div>
        ) : installations.length > 0 ? (
          <div className="grid gap-4">
            {installations.map((installation) => (
              <GitHubProfileCard
                key={installation.integrationId}
                installation={installation}
                isDisconnecting={disconnectingId === installation.integrationId}
                onCopy={copyIntegrationId}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Github className="size-8 text-fg-4" />
            <p className="mt-4 text-sm font-semibold text-fg">No GitHub accounts connected</p>
            <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-3">
              Connect a personal or organization account. You choose exactly which repositories
              GitTerm can access.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

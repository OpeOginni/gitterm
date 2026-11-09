"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { apiPath } from "@gitterm/schema/url";
import { GitHub as Github } from "@/components/logos/Github";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyField } from "@/components/dashboard/copy-field";
import { SettingsEmpty } from "@/components/dashboard/settings/settings-page";
import { Panel, PanelRow, SectionHeading, StatusDot } from "@/components/dashboard/kit";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { queryClient, trpc } from "@/utils/trpc";
import env from "@gitterm/env/web";

/** Where GitHub sends the user after they install the app; the server stores the installation. */
export function githubInstallUrl(slug: string): string {
  const redirectUrl = apiPath(env.NEXT_PUBLIC_SERVER_URL || "", "github/callback");
  return `https://github.com/apps/${slug}/installations/new?redirect_uri=${encodeURIComponent(redirectUrl)}`;
}

/** Remembered across the GitHub round trip so the callback can return the user to this page. */
export const GITHUB_RETURN_TO_KEY = "gitterm:github-return-to";

type Installation = {
  id: string;
  integrationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  installedAt: Date | string;
  suspended: boolean;
};

/** Copies a connection ID for the SDK, with a brief check mark. */
function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy the integration ID");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={copy}
      title={`Connection ID: ${id}`}
      className={cn("gap-1.5 text-fg-3 hover:text-fg", copied && "text-primary hover:text-primary")}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy ID"}</span>
    </Button>
  );
}

function InstallationRow({
  installation,
  isDisconnecting,
  onDisconnect,
}: {
  installation: Installation;
  isDisconnecting: boolean;
  onDisconnect: (id: string) => void;
}) {
  const connected = new Date(installation.installedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <Image
          src={`https://github.com/${installation.accountLogin}.png`}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="truncate text-[14px] font-medium text-fg">
              @{installation.accountLogin}
            </span>
            <StatusDot tone={installation.suspended ? "danger" : "ok"}>
              {installation.suspended ? "Suspended" : "Connected"}
            </StatusDot>
          </div>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            {installation.accountType === "Organization" ? "Organization" : "Personal account"}
            <span className="text-fg-4"> · </span>
            {installation.repositorySelection === "all"
              ? "All repositories"
              : "Selected repositories"}
            <span className="text-fg-4"> · Since {connected}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 max-sm:-ml-2.5 max-sm:w-full">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 text-fg-3 hover:text-fg">
            <a
              href={`https://github.com/settings/installations/${installation.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Manage
              <ExternalLink className="size-3" />
            </a>
          </Button>
          <CopyIdButton id={installation.integrationId} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDisconnect(installation.integrationId)}
            disabled={isDisconnecting}
            className="gap-1.5 text-fg-3 hover:bg-destructive/10 hover:text-destructive"
          >
            {isDisconnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Disconnect
          </Button>
        </div>
      </div>
      {installation.suspended ? (
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-destructive sm:pl-[3.125rem]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Git operations are paused. Resolve this installation on GitHub to reconnect it.
        </p>
      ) : null}
    </li>
  );
}

/** Repository access the admin set up with a token: shared by everyone, nothing to connect. */
function SharedGitHub({
  accountLogin,
  patSuffix,
}: {
  accountLogin: string;
  patSuffix: string | null;
}) {
  return (
    <Panel>
      <PanelRow className="flex-wrap gap-y-3 py-4">
        <Image
          src={`https://github.com/${accountLogin}.png`}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="truncate text-[14px] font-medium text-fg">@{accountLogin}</span>
            <StatusDot tone="ok">Shared by your admin</StatusDot>
          </div>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            Every workspace uses this access
            {patSuffix ? <span className="font-mono text-fg-4"> · token …{patSuffix}</span> : null}
          </p>
        </div>
      </PanelRow>
      <PanelRow className="block py-4">
        <CopyField label="Connection ID for the SDK" value="github:shared" />
      </PanelRow>
    </Panel>
  );
}

export function GitHubTitle() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Github className="size-5 shrink-0 text-fg" fill="currentColor" />
      GitHub
    </span>
  );
}

export function GitHubConnection() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const { data, isLoading, refetch } = useQuery(trpc.github.getInstallationStatus.queryOptions());
  const { data: integrationCatalog } = useQuery(trpc.integrations.list.queryOptions());
  const { data: appAvailability, isLoading: isLoadingAvailability } = useQuery(
    trpc.github.appAvailability.queryOptions(),
  );
  const isEnabled =
    integrationCatalog?.find((integration) => integration.key === "github")?.enabled === true;
  const disconnectMutation = useMutation(trpc.github.disconnectApp.mutationOptions());
  const installations = data?.installations ?? [];

  function handleConnect() {
    if (!appAvailability?.enabled || !appAvailability.configured || !appAvailability.slug) return;
    setIsConnecting(true);
    window.location.href = githubInstallUrl(appAvailability.slug);
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

  const notSetUp = isEnabled && appAvailability && !appAvailability.mode;

  return (
    <section className="space-y-4">
      <SectionHeading
        title={<GitHubTitle />}
        description={
          installations.length > 0 || appAvailability?.mode === "pat"
            ? undefined
            : "Repository access for your workspaces."
        }
        action={
          installations.length > 0 || appAvailability?.configured ? (
            <>
              {installations.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  aria-label="Refresh GitHub connections"
                  className="text-fg-3 hover:text-fg"
                >
                  <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
                </Button>
              ) : null}
              {appAvailability?.configured ? (
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={isConnecting || !isEnabled}
                  className="gap-1.5"
                >
                  {isConnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {installations.length > 0 ? "Add account" : "Connect GitHub"}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {isLoading || isLoadingAvailability ? (
        <Skeleton className="h-[88px] w-full rounded-xl bg-fill" />
      ) : isEnabled && appAvailability?.mode === "pat" && appAvailability.accountLogin ? (
        <SharedGitHub
          accountLogin={appAvailability.accountLogin}
          patSuffix={appAvailability.patSuffix}
        />
      ) : notSetUp ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <SettingsEmpty
            icon={<Github fill="currentColor" />}
            title={
              <span className="flex flex-wrap items-center gap-x-2.5">
                Not set up yet
                <StatusDot tone="muted">Waiting on admin</StatusDot>
              </span>
            }
            description="An admin adds a GitHub App or token first. Until then, workspaces can clone public repositories."
          />
          {session?.user.role === "admin" ? (
            <Link
              href={"/admin/integrations/github" as Route}
              className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-medium text-primary hover:underline max-sm:pl-12"
            >
              Set up GitHub
              <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      ) : installations.length > 0 ? (
        <ul className="max-h-[44rem] divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line">
          {installations.map((installation) => (
            <InstallationRow
              key={installation.integrationId}
              installation={installation}
              isDisconnecting={disconnectingId === installation.integrationId}
              onDisconnect={handleDisconnect}
            />
          ))}
        </ul>
      ) : appAvailability?.configured ? (
        <div className="rounded-xl border border-line px-4 py-4 sm:px-5">
          <SettingsEmpty
            icon={<Github fill="currentColor" />}
            title="No GitHub account yet"
            description="Connect a personal or organization account, then choose which repositories GitTerm can reach."
          />
        </div>
      ) : null}
    </section>
  );
}

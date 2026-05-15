"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { queryClient, trpc } from "@/utils/trpc";
import {
  CheckCircle2,
  XCircle,
  GitBranch,
  AlertCircle,
  Lock,
  Zap,
  ExternalLink,
  Shield,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { GitHub as Github } from "@/components/logos/Github";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import env from "@gitterm/env/web";

const GITHUB_APP_NAME = env.NEXT_PUBLIC_GITHUB_APP_NAME || "gitterm-dev";

export function GitHubConnection() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: installationData,
    isLoading,
    refetch,
  } = useQuery(trpc.github.getInstallationStatus.queryOptions());
  const disconnectMutation = useMutation(trpc.github.disconnectApp.mutationOptions());

  const handleConnect = () => {
    setIsConnecting(true);
    const redirectUrl = `${env.NEXT_PUBLIC_SERVER_URL}/api/github/callback`;
    window.location.href = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?redirect_uri=${encodeURIComponent(redirectUrl)}`;
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success("Installation status refreshed");
    } catch {
      toast.error("Failed to refresh status");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectMutation.mutateAsync();
      toast.success("GitHub App disconnect requested. Changes will take effect shortly.");
      await queryClient.invalidateQueries({
        queryKey: trpc.github.getInstallationStatus.queryKey(),
      });
    } catch {
      toast.error("Failed to disconnect GitHub App");
    }
  };

  if (isLoading) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center gap-3">
          <div className="rounded-xl border border-border bg-foreground/[0.02] p-2.5">
            <Github className="h-5 w-5 text-foreground/60" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground/90">GitHub Integration</h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              git provider
            </span>
          </div>
        </div>
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const isConnected = installationData?.connected ?? false;
  const installation = installationData?.installation;
  const isSuspended = installation?.suspended ?? false;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <div className="relative px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl border border-border bg-foreground/[0.02] p-2.5">
              <Github className="h-5 w-5 text-foreground/70" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-foreground/90">GitHub Integration</h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  git provider
                </span>
                {isConnected && !isSuspended && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </span>
                )}
                {isSuspended && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                    <AlertCircle className="h-3 w-3" />
                    Suspended
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Clone, commit, and push repositories from your workspaces.
              </p>
            </div>
          </div>
          {isConnected && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80"
              aria-label="Refresh status"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      <div className="relative space-y-5 px-6 pb-6">
        {isConnected && installation ? (
          <>
            {/* Installation info */}
            <div className="rounded-xl border border-border bg-foreground/[0.02] p-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/15 bg-emerald-500/10">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground/90">@{installation.accountLogin}</p>
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {installation.accountType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    <span>
                      {installation.repositorySelection === "all"
                        ? "Access to all repositories"
                        : "Access to selected repositories"}
                    </span>
                  </div>
                  {installation.installedAt && (
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                      Connected{" "}
                      {new Date(installation.installedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Suspended warning */}
            {isSuspended && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4">
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-300">Installation Suspended</p>
                    <p className="text-sm text-muted-foreground">
                      Your GitHub App installation has been suspended. Git operations will not work
                      until you resolve this on GitHub.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Feature grid */}
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { icon: Lock, label: "Secure Access", desc: "No personal tokens" },
                { icon: Zap, label: "Auto Refresh", desc: "Tokens renew automatically" },
                { icon: GitBranch, label: "Full Git Ops", desc: "Clone, commit, push, pull" },
              ].map((feature) => (
                <div
                  key={feature.label}
                  className="rounded-xl border border-border bg-foreground/[0.02] p-3.5 transition-colors hover:border-amber-400/20"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <feature.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground/80">{feature.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                onClick={() =>
                  window.open(
                    `https://github.com/settings/installations/${installationData.installation.id}`,
                    "_blank",
                  )
                }
                variant="outline"
                className="flex-1"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Manage on GitHub
              </Button>
              <Button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                variant="outline"
                className="flex-1 border-red-500/20 bg-red-500/[0.06] text-red-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
              >
                {disconnectMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Disconnect
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Empty state */}
            <div className="rounded-xl border border-dashed border-border bg-foreground/[0.015] p-8 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-foreground/[0.03]">
                  <Github className="h-7 w-7 text-foreground/40" />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    Not connected
                  </p>
                  <p className="mt-1.5 text-base font-semibold text-foreground/90">
                    Link a GitHub account
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    Unlock git operations and repository management inside every workspace.
                  </p>
                </div>
              </div>
            </div>

            {/* Feature list */}
            <div className="space-y-0.5">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                What you'll get
              </p>
              {[
                { icon: Lock, text: "Clone private repositories securely" },
                { icon: GitBranch, text: "Commit and push changes from workspaces" },
                { icon: Zap, text: "Automatic token refresh (no manual setup)" },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="group/feature flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-foreground/[0.03]"
                >
                  <feature.icon className="h-4 w-4 text-muted-foreground transition-colors group-hover/feature:text-primary" />
                  <span className="text-sm text-foreground/70">{feature.text}</span>
                </div>
              ))}
            </div>

            {/* Connect button */}
            <Button
              variant="outline"
              className="w-full border-border bg-foreground/[0.02] font-mono text-xs font-bold uppercase tracking-[0.18em] text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting to GitHub...
                </>
              ) : (
                <>
                  <Github className="mr-2 h-5 w-5" />
                  Connect GitHub App
                </>
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              You'll be redirected to GitHub to install the app. You can choose which repositories
              to grant access to.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

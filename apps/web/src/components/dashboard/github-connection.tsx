"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { queryClient, trpc } from "@/utils/trpc";
import {
  CheckCircle2,
  XCircle,
  GitBranch,
  AlertCircle,
  Github,
  GitFork,
  Lock,
  Zap,
  ExternalLink,
  Shield,
  RefreshCw,
  Loader2,
  Bot,
} from "lucide-react";
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
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center gap-3 mb-2">
          <Github className="h-5 w-5 text-white/40" />
          <span className="text-lg font-semibold text-white/80">GitHub Integration</span>
        </div>
        <p className="text-sm text-white/30 mb-6">
          Connect your GitHub account to enable git operations in workspaces
        </p>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-white/20" />
        </div>
      </div>
    );
  }

  const isConnected = installationData?.connected ?? false;
  const installation = installationData?.installation;
  const isSuspended = installation?.suspended ?? false;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-white/50" />
            <span className="text-lg font-semibold text-white/90">GitHub Integration</span>
            {isConnected && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </span>
            )}
          </div>
          {isConnected && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.04] hover:text-white/60"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-sm text-white/35">
          Connect your GitHub account to enable git operations (clone, commit, push, fork) in your
          workspaces
        </p>
      </div>

      {/* Content */}
      <div className="space-y-5 px-6 pb-6">
        {isConnected && installation ? (
          <>
            {/* Installation info */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-white/90">@{installation.accountLogin}</p>
                      <span className="rounded-full border border-white/[0.08] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/30">
                        {installation.accountType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/40">
                      <Shield className="h-3.5 w-3.5" />
                      <span>
                        {installation.repositorySelection === "all"
                          ? "Access to all repositories"
                          : "Access to selected repositories"}
                      </span>
                    </div>
                    {installation.installedAt && (
                      <p className="text-xs text-white/25">
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
                {isSuspended && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
                    <AlertCircle className="h-3 w-3" />
                    Suspended
                  </span>
                )}
              </div>
            </div>

            {/* Suspended warning */}
            {isSuspended && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4">
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-300">Installation Suspended</p>
                    <p className="text-sm text-white/40">
                      Your GitHub App installation has been suspended. Git operations will not work
                      until you resolve this on GitHub.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Feature grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Lock, label: "Secure Access", desc: "No personal tokens needed" },
                { icon: GitFork, label: "Quick Fork", desc: "Fork repos instantly" },
                { icon: Zap, label: "Auto Refresh", desc: "Tokens refresh automatically" },
                { icon: GitBranch, label: "Full Git Ops", desc: "Clone, commit, push & pull" },
              ].map((feature) => (
                <div
                  key={feature.label}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 transition-colors hover:border-white/[0.1]"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <feature.icon className="h-4 w-4 text-white/30" />
                    <span className="text-sm font-medium text-white/70">{feature.label}</span>
                  </div>
                  <p className="text-xs text-white/30">{feature.desc}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                onClick={() => window.open("https://github.com/settings/installations", "_blank")}
                variant="outline"
                className="flex-1 border-white/[0.08] bg-transparent text-white/60 hover:border-white/[0.15] hover:bg-white/[0.04] hover:text-white/80"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Manage on GitHub
              </Button>
              <Button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="flex-1 border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
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
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
                  <Github className="h-7 w-7 text-white/30" />
                </div>
                <div>
                  <p className="text-base font-semibold text-white/80">No GitHub Connection</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-white/35">
                    Connect your GitHub account to unlock git operations and repository management
                    in your workspaces
                  </p>
                </div>
              </div>
            </div>

            {/* Feature list */}
            <div className="space-y-1">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-white/25">
                What you'll get
              </p>
              {[
                { icon: Lock, text: "Clone private repositories securely" },
                { icon: GitBranch, text: "Commit and push changes from workspaces" },
                { icon: GitFork, text: "Fork repositories with one click" },
                { icon: Zap, text: "Automatic token refresh (no manual setup)" },
                { icon: Bot, text: "Connection to automated agent loops" },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-white/[0.03]"
                >
                  <feature.icon className="h-4 w-4 text-white/25 transition-colors group-hover:text-primary" />
                  <span className="text-sm text-white/55">{feature.text}</span>
                </div>
              ))}
            </div>

            {/* Connect button */}
            <Button
              className="w-full bg-primary font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
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

            <p className="text-center text-xs text-white/25">
              You'll be redirected to GitHub to install the app. You can choose which repositories
              to grant access to.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

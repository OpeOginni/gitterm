"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";
import { CheckCircle2, XCircle, GitBranch, AlertCircle, Github, GitFork, Lock, Zap, ExternalLink, Shield, RefreshCw } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || "gitterm-dev";

export function GitHubConnection() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { data: installationData, isLoading, refetch } = useQuery(trpc.github.getInstallationStatus.queryOptions());
  const disconnectMutation = useMutation(trpc.github.disconnectApp.mutationOptions());

  // Refetch installation status on mount (in case we just came back from GitHub)
  useEffect(() => {
    refetch();
  }, [refetch]);

  const handleConnect = () => {
    setIsConnecting(true);
    const redirectUrl = `${process.env.NEXT_PUBLIC_WEB_URL}/api/github/callback`;
    window.location.href = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?redirect_uri=${redirectUrl}`;
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success("Installation status refreshed");
    } catch (error) {
      toast.error("Failed to refresh status");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    if (confirm("Are you sure you want to disconnect your GitHub App? This will disable git operations in your workspaces.")) {
      try {
        await disconnectMutation.mutateAsync();
        await refetch();
        toast.success("GitHub App disconnected successfully");
      } catch (error) {
        toast.error("Failed to disconnect GitHub App");
      }
    }
  };

  if (isLoading) {
    return (
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Github className="h-5 w-5" />
            </div>
            GitHub Integration
          </CardTitle>
          <CardDescription>
            Connect your GitHub account to enable git operations in workspaces
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isConnected = installationData?.connected ?? false;
  const installation = installationData?.installation;
  const isSuspended = installation?.suspended ?? false;

  return (
    <Card className={`border-2 transition-all ${isConnected ? 'border-green-500/20 bg-green-50/5 dark:bg-green-950/5' : ''}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-green-500/10' : 'bg-primary/10'}`}>
              <Github className="h-5 w-5" />
            </div>
            GitHub Integration
            {isConnected && (
              <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            )}
          </CardTitle>
          {isConnected && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 w-8"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
        <CardDescription>
          Connect your GitHub account to enable git operations (clone, commit, push, fork) in your workspaces
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isConnected && installation ? (
          <>
            {/* Connection Status Card */}
            <div className={`p-4 border-2 rounded-xl transition-all ${
              isSuspended 
                ? 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20' 
                : 'border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20'
            }`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${
                    isSuspended ? 'bg-red-500/10' : 'bg-green-500/10'
                  }`}>
                    {isSuspended ? (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-base">@{installation.accountLogin}</p>
                      <Badge variant="outline" className="text-xs">
                        {installation.accountType}
                      </Badge>
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
                      <p className="text-xs text-muted-foreground">
                        Connected {new Date(installation.installedAt).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </p>
                    )}
                  </div>
                </div>
                {isSuspended && (
                  <Badge variant="destructive" className="ml-2">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Suspended
                  </Badge>
                )}
              </div>
            </div>

            {isSuspended && (
              <div className="p-4 border border-red-200 dark:border-red-900 rounded-lg bg-red-50/50 dark:bg-red-950/20">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-sm text-red-900 dark:text-red-100">
                      Installation Suspended
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300">
                      Your GitHub App installation has been suspended. Git operations will not work until you resolve this on GitHub.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Features Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Secure Access</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  No personal tokens needed
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <GitFork className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Quick Fork</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Fork repos instantly
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Auto Refresh</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tokens refresh automatically
                </p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Full Git Ops</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Clone, commit, push & pull
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => window.open(`https://github.com/settings/installations`, "_blank")}
                className="flex-1"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Manage on GitHub
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="flex-1"
              >
                {disconnectMutation.isPending ? (
                  <>
                    <Loader className="mr-2 h-4 w-4" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 mr-2" />
                    Disconnect
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Not Connected State */}
            <div className="p-6 border-2 border-dashed rounded-xl bg-muted/30 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 bg-muted rounded-full">
                  <Github className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-base mb-1">No GitHub Connection</p>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Connect your GitHub account to unlock git operations and repository management in your workspaces
                  </p>
                </div>
              </div>
            </div>

            {/* Features List */}
            <div className="space-y-3">
              <p className="text-sm font-medium">What you'll get:</p>
              <div className="grid gap-2">
                {[
                  { icon: Lock, text: "Clone private repositories securely" },
                  { icon: GitBranch, text: "Commit and push changes from workspaces" },
                  { icon: GitFork, text: "Fork repositories with one click" },
                  { icon: Zap, text: "Automatic token refresh (no manual setup)" },
                ].map((feature, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="p-1.5 bg-primary/10 rounded-md">
                      <feature.icon className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-sm">{feature.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Connect Button */}
            <Button
              className="w-full h-11"
              onClick={handleConnect}
              disabled={isConnecting}
              size="lg"
            >
              {isConnecting ? (
                <>
                  <Loader className="mr-2 h-4 w-4" />
                  Redirecting to GitHub...
                </>
              ) : (
                <>
                  <Github className="mr-2 h-5 w-5" />
                  Connect GitHub App
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground px-4">
              You'll be redirected to GitHub to install the app. You can choose which repositories to grant access to.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

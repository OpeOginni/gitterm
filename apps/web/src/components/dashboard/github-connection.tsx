"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { queryClient, trpc } from "@/utils/trpc"
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
} from "lucide-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import env from "@gitterm/env/web"

const GITHUB_APP_NAME = env.NEXT_PUBLIC_GITHUB_APP_NAME || "gitterm-dev"

export function GitHubConnection() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { data: installationData, isLoading, refetch } = useQuery(trpc.github.getInstallationStatus.queryOptions())
  const disconnectMutation = useMutation(trpc.github.disconnectApp.mutationOptions())

  useEffect(() => {
    refetch()
  }, [refetch])

  const handleConnect = () => {
    setIsConnecting(true)
    // Use window.location.origin to get the base URL (e.g., http://localhost:8888)
    // The callback route is at /api/github/callback on the backend server (routed via Caddy)
    const redirectUrl = `${env.NEXT_PUBLIC_AUTH_URL}/api/github/callback`
    window.location.href = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?redirect_uri=${encodeURIComponent(redirectUrl)}`
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await refetch()
      toast.success("Installation status refreshed")
    } catch (error) {
      toast.error("Failed to refresh status")
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDisconnect = async () => {
      try {
        await disconnectMutation.mutateAsync()
        toast.success("GitHub App disconnect requested. Changes will take effect shortly.")
        
        await queryClient.invalidateQueries({ queryKey: trpc.github.getInstallationStatus.queryKey() })
      } catch (error) {
        toast.error("Failed to disconnect GitHub App")
      }
  }

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Github className="h-5 w-5" />
            GitHub Integration
          </CardTitle>
          <CardDescription>Connect your GitHub account to enable git operations in workspaces</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const isConnected = installationData?.connected ?? false
  const installation = installationData?.installation
  const isSuspended = installation?.suspended ?? false

  return (
    <Card className="border-border/50 bg-card/50 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-lg">
            <Github className="h-5 w-5" />
            GitHub Integration
            {isConnected && (
              <Badge className="bg-accent/10 text-green-500 border-green-500/20">
                <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
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
              className="h-8 w-8 hover:bg-secondary/50"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
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
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-lg bg-accent/10 ring-1 ring-accent/20">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">@{installation.accountLogin}</p>
                      <Badge variant="outline" className="text-xs border-border/50">
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
                  <Badge variant="destructive" className="ml-2">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Suspended
                  </Badge>
                )}
              </div>
            </div>

            {isSuspended && (
              <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/5">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-sm">Installation Suspended</p>
                    <p className="text-sm text-muted-foreground">
                      Your GitHub App installation has been suspended. Git operations will not work until you resolve
                      this on GitHub.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Lock, label: "Secure Access", desc: "No personal tokens needed" },
                { icon: GitFork, label: "Quick Fork", desc: "Fork repos instantly" },
                { icon: Zap, label: "Auto Refresh", desc: "Tokens refresh automatically" },
                { icon: GitBranch, label: "Full Git Ops", desc: "Clone, commit, push & pull" },
              ].map((feature) => (
                <div
                  key={feature.label}
                  className="p-3 rounded-lg border border-border/50 bg-secondary/20 hover:border-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <feature.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{feature.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => window.open(`https://github.com/settings/installations`, "_blank")}
                variant="outline"
                className="flex-1 border-border/60 bg-accent hover:bg-accent/50 hover:border-accent/60 hover:text-accent-foreground transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98]"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Manage on GitHub
              </Button>
              <Button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                variant="destructive"
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700 transition-all duration-200 shadow-sm hover:shadow-md hover:shadow-red-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600 disabled:hover:shadow-sm"
              >
                {disconnectMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
            <div className="p-8 border border-dashed border-border/60 rounded-lg text-center bg-secondary/20">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 rounded-full bg-secondary/50 ring-1 ring-border/50">
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

            <div className="space-y-3">
              <p className="text-sm font-medium">What you'll get:</p>
              <div className="grid gap-1">
                {[
                  { icon: Lock, text: "Clone private repositories securely" },
                  { icon: GitBranch, text: "Commit and push changes from workspaces" },
                  { icon: GitFork, text: "Fork repositories with one click" },
                  { icon: Zap, text: "Automatic token refresh (no manual setup)" },
                ].map((feature, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/5 transition-colors group"
                  >
                    <feature.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="text-sm">{feature.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
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

            <p className="text-xs text-center text-muted-foreground">
              You'll be redirected to GitHub to install the app. You can choose which repositories to grant access to.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

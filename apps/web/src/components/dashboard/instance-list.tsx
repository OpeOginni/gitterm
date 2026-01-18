"use client";

import { trpc, queryClient } from "@/utils/trpc";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ExternalLink,
  Trash2,
  PlayCircle,
  GitBranch,
  Clock,
  Globe,
  Box,
  MapPin,
  StopCircle,
  Copy,
  Terminal,
  HeartPlusIcon,
  PauseIcon,
  Monitor,
  Server,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import {
  getWorkspaceUrl,
  getAttachCommand,
  getWorkspaceDisplayUrl,
  getAgentConnectCommand,
} from "@/lib/utils";

const ITEMS_PER_PAGE = 6;

export function InstanceList() {
  const [page, setPage] = useState(0);

  const workspacesQuery = useQuery(
    trpc.workspace.listWorkspaces.queryOptions({
      limit: ITEMS_PER_PAGE,
      offset: page * ITEMS_PER_PAGE,
      status: "active",
    }),
  );

  const providersQuery = useQuery(trpc.workspace.listCloudProviders.queryOptions());

  const isLoading = workspacesQuery.isLoading || providersQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Loading workspaces...</p>
        </div>
      </div>
    );
  }

  const workspaces = workspacesQuery.data?.workspaces || [];
  const pagination = workspacesQuery.data?.pagination;
  const providers = providersQuery.data?.cloudProviders || [];
  const totalPages = pagination ? Math.ceil(pagination.total / ITEMS_PER_PAGE) : 0;

  if (workspaces.length === 0 && page === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center rounded-xl border-primary/50 border-dashed border bg-card/30 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 ring-1 ring-accent/20">
          <Terminal className="h-7 w-7 text-primary" />
        </div>
        <h3 className="mt-5 text-lg font-medium">No active workspaces</h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Create a new workspace to get started with your remote development environment.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => (
          <InstanceCard key={workspace.id} workspace={workspace} providers={providers} />
        ))}
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border/30">
          <p className="text-sm text-muted-foreground">
            Showing {pagination.offset + 1} to{" "}
            {Math.min(pagination.offset + workspaces.length, pagination.total)} of{" "}
            {pagination.total} workspaces
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0 || workspacesQuery.isFetching}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore || workspacesQuery.isFetching}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type Workspace = NonNullable<
  (typeof trpc.workspace.listWorkspaces)["~types"]["output"]
>["workspaces"][number];
type CloudProvider =
  (typeof trpc.workspace.listCloudProviders)["~types"]["output"]["cloudProviders"][number];

function InstanceCard({
  workspace,
  providers,
}: {
  workspace: Workspace;
  providers: CloudProvider[];
}) {
  const [showConnectDialog, setShowConnectDialog] = useState(false);

  const deleteServiceMutation = useMutation(
    trpc.workspace.deleteWorkspace.mutationOptions({
      onSuccess: () => {
        toast.success("Workspace terminated successfully");
        queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });
      },
      onError: (error) => {
        toast.error(`Failed to terminate workspace: ${error.message}`);
      },
    }),
  );

  const stopWorkspaceMutation = useMutation(
    trpc.workspace.stopWorkspace.mutationOptions({
      onSuccess: () => {
        toast.success("Workspace stopped successfully");
        queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });
      },
      onError: (error) => {
        toast.error(`Failed to stop workspace: ${error.message}`);
      },
    }),
  );

  const restartWorkspaceMutation = useMutation(
    trpc.workspace.restartWorkspace.mutationOptions({
      onSuccess: () => {
        toast.success("Workspace restarting...");
        queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });
      },
      onError: (error) => {
        toast.error(`Failed to restart workspace: ${error.message}`);
      },
    }),
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-[oklch(0.7_0.15_160)] animate-pulse" />
            Running
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Pending
          </Badge>
        );
      case "stopped":
        return <Badge variant="secondary">Stopped</Badge>;
      case "terminated":
        return <Badge variant="destructive">Terminated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRepoName = () => {
    if (!workspace.repositoryUrl) return null;
    return workspace.repositoryUrl
      .replace("https://github.com/", "")
      .replace("https://gitlab.com/", "")
      .replace(".git", "");
  };

  const getRegionInfo = () => {
    const provider = providers.find((p) => p.id === workspace.cloudProviderId);
    if (!provider) return { name: "Unknown", location: "Unknown", providerName: "Unknown" };

    const region = provider.regions?.find((r: any) => r.id === workspace.regionId);
    return {
      name: region?.name || "Unknown",
      location: region?.location || "Unknown",
      providerName: provider.name,
    };
  };

  const regionInfo = getRegionInfo();
  const isRunning = workspace.status === "running";
  const isStopped = workspace.status === "stopped";
  const isPending = workspace.status === "pending";

  // Check if this is a tunnel workspace (runs on user's local machine)
  const isLocal =
    providers.find((p) => p.id === workspace.cloudProviderId)?.name.toLowerCase() === "local";
  const isLocalPending = isPending && isLocal;

  // Generate the connect command for tunnel workspaces only
  // Pending tunnel workspaces need the gitterm-agent connect command
  // Running tunnel workspaces can use opencode attach
  const connectCommand = isLocal
    ? isPending
      ? getAgentConnectCommand(workspace.id)
      : workspace.subdomain
        ? getAttachCommand(workspace.subdomain, workspace.image.agentType.name)
        : null
    : null;

  // Get the workspace URL for linking
  const workspaceUrl = workspace.subdomain ? getWorkspaceUrl(workspace.subdomain) : null;
  const workspaceDisplayUrl = workspace.subdomain
    ? getWorkspaceDisplayUrl(workspace.subdomain)
    : null;

  return (
    <>
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="sm:max-w-[525px] border-border/50 bg-card">
          <DialogHeader>
            <DialogTitle className="text-xl">Connect to Local Instance</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Run this command to connect your local server to this tunnel.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-3">
              <Label className="text-sm font-medium">Run this command to connect:</Label>
              <div className="flex gap-2">
                <Input
                  value={connectCommand || ""}
                  readOnly
                  className="font-mono text-sm bg-secondary/50 border-border/50"
                />
                <Button
                  variant="outline"
                  className="border-border/50 hover:bg-secondary/50"
                  onClick={() => {
                    if (connectCommand) {
                      navigator.clipboard.writeText(connectCommand);
                      toast.success("Copied to clipboard");
                    }
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Once connected, your local server will be available at{" "}
                <span className="font-mono text-foreground">{workspaceDisplayUrl}</span>
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setShowConnectDialog(false)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <Card className="group overflow-hidden border-primary/10 bg-card/50 backdrop-blur-sm transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 flex flex-col">
        <CardHeader className="pb-3 px-5 pt-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/50 transition-colors">
                  {isLocal ? (
                    <Terminal className="h-6 w-6 transition-colors text-primary" />
                  ) : (
                    <Box className="h-6 w-6 transition-colors text-primary" />
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <CardTitle className="text-sm font-semibold truncate">
                    {workspace.name || workspace.subdomain}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground truncate">
                    {workspace.image.agentType.name}
                  </span>
                </div>
              </div>
              {getStatusBadge(workspace.status)}
            </div>
            {getRepoName() && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 ml-12">
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-mono" title={workspace.repositoryUrl || ""}>
                  {getRepoName()}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-4 px-5 flex-1">
          <div className="grid gap-2.5 text-xs text-muted-foreground ml-12">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {regionInfo.name} · {regionInfo.location}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Server className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{regionInfo.providerName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {formatDistanceToNow(new Date(workspace.startedAt), { addSuffix: true })}
              </span>
            </div>
            {workspace.lastActiveAt && isRunning && (
              <div className="flex items-center gap-2">
                <HeartPlusIcon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="truncate text-primary/70">
                  Active{" "}
                  {formatDistanceToNow(new Date(workspace.lastActiveAt), { addSuffix: true })}
                </span>
              </div>
            )}
            {workspace.domain && isRunning && (
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <Globe className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                <button
                  onClick={() => {
                    if (workspaceUrl) {
                      navigator.clipboard.writeText(workspaceUrl);
                      toast.success("Domain copied!");
                    }
                  }}
                  className="text-xs font-mono text-primary/80 hover:text-primary truncate transition-colors cursor-pointer underline decoration-dotted underline-offset-2 text-left min-w-0"
                  title={workspaceDisplayUrl || ""}
                >
                  {workspaceDisplayUrl}
                </button>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex gap-2 bg-secondary/30 p-4 border-t border-border/50">
          {isLocalPending && (
            <Button
              size="sm"
              className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
              onClick={() => setShowConnectDialog(true)}
            >
              <Terminal className="h-3.5 w-3.5" />
              View Connect Command
            </Button>
          )}
          {isRunning &&
            workspaceUrl &&
            (isLocal || workspace.serverOnly ? (
              <div className="flex gap-2 flex-1">
                <Button
                  size="sm"
                  className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
                  onClick={() => {
                    if (workspace.subdomain) {
                      const command = getAttachCommand(
                        workspace.subdomain,
                        workspace.image.agentType.name,
                      );
                      navigator.clipboard.writeText(command);
                      toast.success("Attach command copied to clipboard!");
                    }
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Attach
                </Button>
                <Button
                  size="sm"
                  className="h-9 flex-1 text-xs gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
                  asChild
                >
                  <a
                    href={workspaceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    Desktop App
                  </a>
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
                asChild
              >
                <a href={workspaceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Workspace
                </a>
              </Button>
            ))}
          {isStopped && (
            <Button
              size="sm"
              className="h-9 flex-1 text-xs gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={restartWorkspaceMutation.isPending}
              onClick={() => restartWorkspaceMutation.mutate({ workspaceId: workspace.id })}
            >
              {restartWorkspaceMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Restart
            </Button>
          )}

          {(isPending || isRunning) && !isLocalPending && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs border-border/50 hover:bg-secondary/50"
              disabled={stopWorkspaceMutation.isPending}
              onClick={() => stopWorkspaceMutation.mutate({ workspaceId: workspace.id })}
            >
              {stopWorkspaceMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseIcon className="h-3.5 w-3.5" />
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 border-border/50 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20"
            disabled={deleteServiceMutation.isPending}
            onClick={() => deleteServiceMutation.mutate({ workspaceId: workspace.id })}
          >
            {deleteServiceMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}

"use client";

import { trpc, queryClient } from "@/utils/trpc";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, Trash2, PlayCircle, GitBranch, Clock, Globe, Box, MapPin, StopCircle, Copy, Terminal, HeartPlusIcon, PauseIcon } from 'lucide-react';
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useMutation, useQueries } from "@tanstack/react-query";

export function InstanceList() {
  const [workspacesQuery, providersQuery] = useQueries({
    queries: [
      trpc.workspace.listWorkspaces.queryOptions(),
      trpc.workspace.listCloudProviders.queryOptions(),
    ],
  });

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

  const activeWorkspaces = (workspacesQuery.data?.workspaces || []).filter(
    (ws) => ws.status !== "terminated"
  );

  const providers = providersQuery.data?.cloudProviders || [];

  if (activeWorkspaces.length === 0) {
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
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {activeWorkspaces.map((workspace) => (
        <InstanceCard 
          key={workspace.id} 
          workspace={workspace}
          providers={providers}
        />
      ))}
    </div>
  );
}

type Workspace = typeof trpc.workspace.listWorkspaces["~types"]["output"]["workspaces"][number];
type CloudProvider = typeof trpc.workspace.listCloudProviders["~types"]["output"]["cloudProviders"][number];

function InstanceCard({ workspace, providers }: { workspace: Workspace; providers: CloudProvider[] }) {
  const deleteServiceMutation = useMutation(trpc.workspace.deleteWorkspace.mutationOptions({
    onSuccess: () => {
      toast.success("Workspace terminated successfully");
      queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
    },
    onError: (error) => {
      toast.error(`Failed to terminate workspace: ${error.message}`);
    },
  }));

  const stopWorkspaceMutation = useMutation(trpc.workspace.stopWorkspace.mutationOptions({
    onSuccess: () => {
      toast.success("Workspace stopped successfully");
      queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
    },
    onError: (error) => {
      toast.error(`Failed to stop workspace: ${error.message}`);
    },
  }));

  const restartWorkspaceMutation = useMutation(trpc.workspace.restartWorkspace.mutationOptions({
    onSuccess: () => {
      toast.success("Workspace restarting...");
      queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
    },
    onError: (error) => {
      toast.error(`Failed to restart workspace: ${error.message}`);
    },
  }));

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

  return (
    <Card className="group overflow-hidden border-primary/10 bg-card/50 backdrop-blur-sm transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 flex flex-col">
      <CardHeader className="pb-3 px-5 pt-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/50 transition-colors">
                <Box className="h-4 w-4 transition-colors text-primary" />
              </div>
              <div className="flex flex-col min-w-0">
                <CardTitle className="text-sm font-semibold truncate">
                  {workspace.subdomain}
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
            <Globe className="h-3.5 w-3.5 shrink-0" />
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
                Active {formatDistanceToNow(new Date(workspace.lastActiveAt), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 bg-secondary/30 p-4 border-t border-border/50">
        {isRunning && workspace.domain && (
          workspace.serverOnly ? (
            <Button 
              size="sm" 
              className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                const command = `opencode attach https://${workspace.domain}`;
                navigator.clipboard.writeText(command);
                toast.success("Command copied to clipboard!");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Attach Command
            </Button>
          ) : (
            <Button 
              size="sm" 
              className="h-9 flex-1 text-xs gap-2 bg-primary/80 text-primary-foreground hover:bg-primary/90" 
              asChild
            >
              <a href={`https://${workspace.domain}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Workspace
              </a>
            </Button>
          )
        )}
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

        {(isPending || isRunning) && (
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
  );
}

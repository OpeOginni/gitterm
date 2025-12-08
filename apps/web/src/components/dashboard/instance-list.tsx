"use client";

import { trpc, queryClient } from "@/utils/trpc";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, Trash2, PlayCircle, GitBranch, Clock, Globe, Box, MapPin, StopCircle, Copy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useMutation, useQueries } from "@tanstack/react-query";

export function InstanceList() {
  // Fetch workspaces and cloud providers in parallel
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Filter out terminated workspaces
  const activeWorkspaces = (workspacesQuery.data?.workspaces || []).filter(
    (ws) => ws.status !== "terminated"
  );

  const providers = providersQuery.data?.cloudProviders || [];

  if (activeWorkspaces.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center animate-in fade-in-50">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <PlayCircle className="h-6 w-6 text-primary" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">No active workspaces</h3>
        <p className="mb-4 mt-2 text-sm text-muted-foreground max-w-sm">
          Create a new workspace to get started with your development environment.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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

function InstanceCard({ workspace, providers }: { workspace: any; providers: any[] }) {
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
        return <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-500/20 shrink-0">Running</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/15 text-yellow-600 hover:bg-yellow-500/25 border-yellow-500/20 shrink-0">Pending</Badge>;
      case "stopped":
        return <Badge variant="secondary" className="shrink-0">Stopped</Badge>;
      case "terminated":
        return <Badge variant="destructive" className="shrink-0">Terminated</Badge>;
      default:
        return <Badge variant="outline" className="shrink-0">{status}</Badge>;
    }
  };

  // Extract a readable name from the image ID
  const getWorkspaceName = () => {
    if (!workspace.imageId) return "Workspace";
    // If it's a UUID, use generic name
    if (workspace.imageId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return "Workspace";
    }
    // If it's a docker image, extract the image name
    const parts = workspace.imageId.split("/");
    const imageName = parts[parts.length - 1].split(":")[0];
    return imageName.charAt(0).toUpperCase() + imageName.slice(1);
  };

  const getRepoName = () => {
    if (!workspace.repositoryUrl) return null;
    return workspace.repositoryUrl
      .replace("https://github.com/", "")
      .replace("https://gitlab.com/", "")
      .replace(".git", "");
  };

  // Get region details from providers
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
    <Card className="overflow-hidden transition-all hover:shadow-lg border-border/50 flex flex-col">
      <CardHeader className="pb-3 px-4 pt-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="p-1.5 rounded-md bg-primary/10">
                <Box className="h-3.5 w-3.5 text-primary shrink-0" />
              </div>
              <CardTitle className="text-sm font-semibold truncate">
                {workspace.subdomain}
              </CardTitle>
            </div>
            {getStatusBadge(workspace.status)}
          </div>
          {getRepoName() && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 pl-8">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono" title={workspace.repositoryUrl}>
                {getRepoName()}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3 px-4 flex-1">
        <div className="grid gap-2.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {regionInfo.name} ({regionInfo.location})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{regionInfo.providerName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Started {formatDistanceToNow(new Date(workspace.startedAt), { addSuffix: true })}
            </span>
          </div>
          {workspace.lastActiveAt && isRunning && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-green-500" />
              <span className="truncate text-green-600">
                Active {formatDistanceToNow(new Date(workspace.lastActiveAt), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 bg-muted/30 p-3 border-t">
      {isRunning && workspace.domain && (
          workspace.serverOnly ? (
            <Button 
              variant="default" 
              size="sm" 
              className="h-9 flex-1 text-xs gap-1.5"
              onClick={() => {
                const command = `opencode --attach ${workspace.domain}`;
                navigator.clipboard.writeText(command);
                toast.success("Command copied to clipboard!");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Attach Command
            </Button>
          ) : (
            <Button variant="default" size="sm" className="h-9 flex-1 text-xs gap-1.5" asChild>
              <a href={`https://${workspace.domain}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Workspace
              </a>
            </Button>
          )
        )}
        {isStopped && (
          <Button
            variant="default"
            size="sm"
            className="h-9 flex-1 text-xs gap-1.5"
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
            className="h-9 px-3 text-xs"
            disabled={stopWorkspaceMutation.isPending}
            onClick={() => stopWorkspaceMutation.mutate({ workspaceId: workspace.id })}
          >
            {stopWorkspaceMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <StopCircle className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        
        <Button 
          variant="outline" 
          size="sm" 
          className="h-9 px-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20"
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


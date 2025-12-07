"use client";

import { useState, useEffect, useMemo } from "react";
import { listenerTrpc, queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, ArrowUpRight, InfoIcon, Loader2, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

const ICON_MAP: Record<string, string> = {
  "opencode": "/opencode.svg",
  "railway": "/railway.svg",
  "aws": "/EC2.svg",
  "claude": "/code.svg", 
};

const getIcon = (name: string) => {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(ICON_MAP)) {
    if (key.includes(k)) return v;
  }
  return "/opencode.svg"; // default
};

export function CreateInstanceDialog() {
  const { data: session } = authClient.useSession();

  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>("");
  const [selectedCloudProviderId, setSelectedCloudProviderId] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>(undefined);
  const [selectedGitInstallationId, setSelectedGitInstallationId] = useState<string | undefined>("none");
  const [selectedPersistent, setSelectedPersistent] = useState<boolean>(true);

  // Fetch dynamic data
  const { data: agentTypesData } = useQuery(trpc.workspace.listAgentTypes.queryOptions());
  const { data: cloudProvidersData } = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());


  // Derive available regions from selected cloud provider
  const availableRegions = useMemo(() => {
    if (!selectedCloudProviderId || !cloudProvidersData?.cloudProviders) {
      return [];
    }
    const selectedCloud = cloudProvidersData.cloudProviders.find(
      (cloud) => cloud.id === selectedCloudProviderId,
    );
    return selectedCloud?.regions ?? [];
  }, [selectedCloudProviderId, cloudProvidersData]);

  // Set defaults when data loads
  useEffect(() => {
    if (agentTypesData?.agentTypes?.[0] && !selectedAgentTypeId) {
      setSelectedAgentTypeId(agentTypesData.agentTypes[0].id);
    }
  }, [agentTypesData, selectedAgentTypeId]);

  useEffect(() => {
    if (cloudProvidersData?.cloudProviders?.[0] && !selectedCloudProviderId) {
      setSelectedCloudProviderId(cloudProvidersData.cloudProviders[0].id);
    }
  }, [cloudProvidersData, selectedCloudProviderId]);

  // Set default region when cloud provider changes
  useEffect(() => {
    if (availableRegions.length > 0) {
      // Only set default if no region is selected or selected region is not in available regions
      if (!selectedRegion || !availableRegions.some(reg => reg.id === selectedRegion)) {
        setSelectedRegion(availableRegions[0].id);
      }
    } else {
      setSelectedRegion(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableRegions]); // Only react to availableRegions changes (cloud provider changes) 

  const subscribeToWorkspaceStatus = async (workspaceId: string, userId: string) => {
    return new Promise<void>((resolve, reject) => {
      const subscription = listenerTrpc.workspace.status.subscribe(
        { workspaceId, userId },
        {
          onData: (payload) => {
            if (payload.status === "running") {
              toast.success("Workspace is ready! Redirecting you now");
              queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());

              console.log(payload.workspaceDomain);
              subscription.unsubscribe();
              console.log("Unsubscribed from workspace status");
              resolve();
            }
          },
          onError: (error) => {
            console.error(error);
            toast.error(`Failed to subscribe to workspace status: ${error.message}`);
            reject(error);
          },
        }
      );
    });
  };

  const createServiceMutation = useMutation(trpc.workspace.createWorkspace.mutationOptions({
    onSuccess: async (data) => {
      toast.success("Workspace is provisioning");
      setOpen(false);
      queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());

      console.log("Subscribing to workspace status", data.workspace.id);
      await subscribeToWorkspaceStatus(data.workspace.id, data.workspace.userId);

    },
    onError: (error) => {
      console.error(error);
      toast.error(`Failed to create instance: ${error.message}`);
    },
  }));

  const handleSubmit = async () => {
    if (!selectedAgentTypeId || !selectedCloudProviderId || !selectedRegion) {
      toast.error("Please select an agent, cloud provider, and region.");
      return;
    }

    await createServiceMutation.mutateAsync({
      name: repoUrl.split("/").pop() || "new-workspace",
      repo: repoUrl,
      agentTypeId: selectedAgentTypeId,
      cloudProviderId: selectedCloudProviderId,
      regionId: selectedRegion,
      gitInstallationId: selectedGitInstallationId === "none" ? undefined : selectedGitInstallationId,
      persistent: selectedPersistent,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New Instance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Create New Instance</DialogTitle>
          <DialogDescription>
            Deploy a new development workspace from a GitHub repository.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="repo">GitHub Repository URL</Label>
            <Input
              id="repo"
              placeholder="https://github.com/username/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Agent Type</Label>
              <Select value={selectedAgentTypeId} onValueChange={setSelectedAgentTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {agentTypesData?.agentTypes?.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <div className="flex items-center">
                        <Image 
                          src={getIcon(agent.name)} 
                          alt={agent.name} 
                          width={16} 
                          height={16} 
                          className="mr-2 h-4 w-4" 
                        />
                        {agent.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Cloud Provider</Label>
              <Select value={selectedCloudProviderId} onValueChange={setSelectedCloudProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select cloud" />
                </SelectTrigger>
                <SelectContent>
                  {cloudProvidersData?.cloudProviders && cloudProvidersData.cloudProviders.length > 0 ? (
                    cloudProvidersData?.cloudProviders?.map((cloud) => (
                      <SelectItem key={cloud.id} value={cloud.id}>
                        <div className="flex items-center">
                          <Image 
                            src={getIcon(cloud.name)} 
                            alt={cloud.name} 
                            width={16} 
                            height={16} 
                            className="mr-2 h-4 w-4" 
                          />
                          {cloud.name}
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-cloud-providers" disabled>No cloud providers found</SelectItem>
                  )} 
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">

          <div className="grid gap-2">
            <Label>Region</Label>
            <Select
              value={selectedRegion}
              onValueChange={setSelectedRegion}
              disabled={availableRegions.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={availableRegions.length > 0 ? "Select region" : "Coming soon"}
                />
              </SelectTrigger>
              <SelectContent>
                {availableRegions.length > 0 ? (
                  availableRegions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-regions" disabled>
                    <div className="flex items-center">
                      <AlertCircle className="mr-2 h-4 w-4" />
                     Coming soon
                    </div>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>

            
          </div>

          <div className="grid gap-2">
            <Label >Git Setup <Link href="/dashboard/integrations" className="text-blue-500"><ArrowUpRight className="h-4 w-4" /></Link></Label>
            <Select 
            value={selectedGitInstallationId} 
            onValueChange={setSelectedGitInstallationId}
            disabled={installationsData?.installations && installationsData.installations.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={installationsData?.installations && installationsData.installations.length > 0 ? "Select git installation" : "No git installations found"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" key="none">
                  <div className="flex items-center">
                    None
                  </div>
                </SelectItem>
                {installationsData?.installations && installationsData.installations.length > 0 && (
                  installationsData?.installations?.map((installation) => (
                    <SelectItem key={installation.git_integration.id} value={installation.git_integration.id}>
                      <div className="flex items-center">
                        <Image 
                            src={"/github.svg"} 
                            alt="GitHub" 
                            width={16} 
                            height={16} 
                            className="mr-2 h-4 w-4" 
                          />
                          {installation.git_integration.providerAccountLogin}
                        </div>
                    </SelectItem>
                  ))
                )}
            </SelectContent>
            </Select>

          </div>

          <div className="flex items-start gap-3 col-span-2">
            <Checkbox
              id="persistent"
              checked={selectedPersistent}
              defaultChecked
              onCheckedChange={(checked) => setSelectedPersistent(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="persistent"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Persistent Workspace
              </Label>
              <p className="text-xs text-muted-foreground">
                Keep workspace files when paused (uses more storage)
              </p>
            </div>
          </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!repoUrl || createServiceMutation.isPending || !selectedAgentTypeId}>
            {createServiceMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Instance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
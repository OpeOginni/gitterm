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
  const [workspaceType, setWorkspaceType] = useState<"cloud" | "local">("cloud");
  const [repoUrl, setRepoUrl] = useState("");
  const [localSubdomain, setLocalSubdomain] = useState("");
  const [localName, setLocalName] = useState("");
  const [cliCommand, setCliCommand] = useState<string | null>(null);
  const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>("");
  const [selectedCloudProviderId, setSelectedCloudProviderId] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>(undefined);
  const [selectedGitInstallationId, setSelectedGitInstallationId] = useState<string | undefined>("none");
  const [selectedPersistent, setSelectedPersistent] = useState<boolean>(true);

  // Fetch dynamic data
  const { data: agentTypesData } = useQuery(trpc.workspace.listAgentTypes.queryOptions());
  const { data: cloudProvidersData } = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());

  // Memoized values
  const localProvider = useMemo(() => {
    return cloudProvidersData?.cloudProviders?.find(
      (cloud) => cloud.name.toLowerCase() === "local"
    );
  }, [cloudProvidersData]);

  const cloudProviders = useMemo(() => {
    return cloudProvidersData?.cloudProviders?.filter(
      (cloud) => cloud.name.toLowerCase() !== "local"
    ) ?? [];
  }, [cloudProvidersData]);

  const availableRegions = useMemo(() => {
    if (!selectedCloudProviderId || !cloudProvidersData?.cloudProviders) {
      return [];
    }
    const selectedCloud = cloudProvidersData.cloudProviders.find(
      (cloud) => cloud.id === selectedCloudProviderId,
    );
    return selectedCloud?.regions ?? [];
  }, [selectedCloudProviderId, cloudProvidersData]);

  // Initialize agent type when data loads
  useEffect(() => {
    if (!selectedAgentTypeId && agentTypesData?.agentTypes?.[0]) {
      setSelectedAgentTypeId(agentTypesData.agentTypes[0].id);
    }
  }, [agentTypesData, selectedAgentTypeId]);

  // Handle workspace type changes
  useEffect(() => {
    if (workspaceType === "local" && localProvider) {
      // For local: auto-select local provider and its first region
      if (localProvider.id !== selectedCloudProviderId) {
        setSelectedCloudProviderId(localProvider.id);
        setSelectedRegion(localProvider.regions?.[0]?.id);
      }
    } else if (workspaceType === "cloud" && localProvider) {
      // Switching back to cloud: if currently on local provider, switch to first cloud provider
      if (selectedCloudProviderId === localProvider.id && cloudProviders[0]) {
        setSelectedCloudProviderId(cloudProviders[0].id);
      }
    }
  }, [workspaceType, localProvider, selectedCloudProviderId, cloudProviders]);

  // Initialize cloud provider for cloud workspaces
  useEffect(() => {
    if (workspaceType === "cloud" && !selectedCloudProviderId && cloudProviders[0]) {
      setSelectedCloudProviderId(cloudProviders[0].id);
    }
  }, [workspaceType, cloudProviders, selectedCloudProviderId]);

  // Update region when available regions change
  useEffect(() => {
    if (workspaceType === "cloud") {
      if (availableRegions.length > 0) {
        if (!selectedRegion || !availableRegions.some(reg => reg.id === selectedRegion)) {
          setSelectedRegion(availableRegions[0].id);
        }
      } else {
        setSelectedRegion(undefined);
      }
    }
  }, [workspaceType, availableRegions, selectedRegion]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setCliCommand(null);
      // Don't reset other fields to allow quick reopening with same values
    }
  }, [open]); 

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
      if (data.command) {
        // Local workspace - show connection command
        toast.success("Local tunnel created successfully");
        setCliCommand(data.command);
      } else {
        // Cloud workspace - subscribe to status updates
        toast.success("Workspace is provisioning");
        setOpen(false);
        console.log("Subscribing to workspace status", data.workspace.id);
        await subscribeToWorkspaceStatus(data.workspace.id, data.workspace.userId);
      }
      queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
    },
    onError: (error) => {
      console.error(error);
      toast.error(`Failed to create workspace: ${error.message}`);
    },
  }));

  const handleSubmit = async () => {
    if (workspaceType === "local") {
      // Validate local workspace fields
      if (!localSubdomain) {
        toast.error("Please enter a subdomain.");
        return;
      }
      if (!selectedAgentTypeId) {
        toast.error("Please select an agent type.");
        return;
      }
      if (!localProvider || !selectedRegion) {
        toast.error("Local provider not available. Please try again.");
        return;
      }
      
      await createServiceMutation.mutateAsync({
        subdomain: localSubdomain,
        name: localName || undefined,
        agentTypeId: selectedAgentTypeId,
        cloudProviderId: localProvider.id,
        regionId: selectedRegion,
        persistent: false,
      });
      return;
    }

    // Validate cloud workspace fields
    if (!repoUrl) {
      toast.error("Please enter a repository URL.");
      return;
    }
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
            {workspaceType === "cloud" 
              ? "Deploy a new development workspace from a GitHub repository."
              : "Create a local tunnel to expose your local development server."}
          </DialogDescription>
        </DialogHeader>

        {cliCommand ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Run this command to connect:</Label>
              <div className="flex gap-2">
                <Input value={cliCommand} readOnly className="font-mono text-sm" />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(cliCommand);
                    toast.success("Copied to clipboard");
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Once connected, your local server will be available at the subdomain you chose.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => { setOpen(false); setCliCommand(null); }}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Workspace Type</Label>
                <Select value={workspaceType} onValueChange={(val) => setWorkspaceType(val as "cloud" | "local")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloud">Cloud Instance</SelectItem>
                    <SelectItem value="local">Local Tunnel</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {workspaceType === "local" ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="subdomain">Subdomain</Label>
                    <Input
                      id="subdomain"
                      placeholder="my-app"
                      value={localSubdomain}
                      onChange={(e) => setLocalSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Your tunnel will be available at: {localSubdomain || "my-app"}.gitterm.dev
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="local-name">Name (optional)</Label>
                    <Input
                      id="local-name"
                      placeholder="My Local App"
                      value={localName}
                      onChange={(e) => setLocalName(e.target.value)}
                    />
                  </div>
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
                    <p className="text-xs text-muted-foreground">
                      Choose which agent you are going to run in your local environment
                    </p>
                  </div>
                </>
              ) : (
                <>
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
                          {cloudProviders.length > 0 ? (
                            cloudProviders.map((cloud) => (
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
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  (workspaceType === "cloud" && (!repoUrl || !selectedAgentTypeId)) ||
                  (workspaceType === "local" && !localSubdomain) ||
                  createServiceMutation.isPending
                }
              >
                {createServiceMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {workspaceType === "local" ? "Create Tunnel" : "Create Instance"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
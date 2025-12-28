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
import { AlertCircle, ArrowUpRight, Cloud, Loader2, Plus, Terminal } from 'lucide-react';
import { toast } from "sonner";
import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { getAgentConnectCommand, getWorkspaceDisplayUrl } from "@/lib/utils";

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
  return "/opencode.svg";
};

export function CreateInstanceDialog() {
  const [open, setOpen] = useState(false);
  const [workspaceType, setWorkspaceType] = useState<"cloud" | "local">("cloud");
  const [repoUrl, setRepoUrl] = useState("");
  const [localSubdomain, setLocalSubdomain] = useState("");
  const [cloudSubdomain, setCloudSubdomain] = useState("");
  const [localName, setLocalName] = useState("");
  const [cliCommand, setCliCommand] = useState<string | null>(null);
  const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>("");
  const [selectedCloudProviderId, setSelectedCloudProviderId] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>(undefined);
  const [selectedGitInstallationId, setSelectedGitInstallationId] = useState<string | undefined>("none");
  const [selectedPersistent, setSelectedPersistent] = useState<boolean>(true);

  const { data: agentTypesData } = useQuery(trpc.workspace.listAgentTypes.queryOptions());
  const { data: cloudProvidersData } = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());
  const { data: subdomainPermissions } = useQuery(trpc.workspace.getSubdomainPermissions.queryOptions());

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

  useEffect(() => {
    if (!selectedAgentTypeId && agentTypesData?.agentTypes?.[0]) {
      setSelectedAgentTypeId(agentTypesData.agentTypes[0].id);
    }
  }, [agentTypesData, selectedAgentTypeId]);

  useEffect(() => {
    if (workspaceType === "local" && localProvider) {
      if (localProvider.id !== selectedCloudProviderId) {
        setSelectedCloudProviderId(localProvider.id);
        setSelectedRegion(localProvider.regions?.[0]?.id);
      }
    } else if (workspaceType === "cloud" && localProvider) {
      if (selectedCloudProviderId === localProvider.id && cloudProviders[0]) {
        setSelectedCloudProviderId(cloudProviders[0].id);
      }
    }
  }, [workspaceType, localProvider, selectedCloudProviderId, cloudProviders]);

  useEffect(() => {
    if (workspaceType === "cloud" && !selectedCloudProviderId && cloudProviders[0]) {
      setSelectedCloudProviderId(cloudProviders[0].id);
    }
  }, [workspaceType, cloudProviders, selectedCloudProviderId]);

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

  useEffect(() => {
    if (!open) {
      setCliCommand(null);
      setCloudSubdomain("");
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
        toast.success("Local tunnel created successfully");
        // Generate the command on the client so it always matches the current host (gitterm.dev vs self-hosted).
        setCliCommand(getAgentConnectCommand(data.workspace.id));
      } else {
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
      subdomain: cloudSubdomain || undefined, // Include custom subdomain if provided
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Instance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px] border-border/50 bg-card">
        <DialogHeader>
          <DialogTitle className="text-xl">Create New Instance</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {workspaceType === "cloud" 
              ? "Deploy a new development workspace from a GitHub repository."
              : "Create a local tunnel to expose your local development server."}
          </DialogDescription>
        </DialogHeader>

        {cliCommand ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-3">
              <Label className="text-sm font-medium">Run this command to connect:</Label>
              <div className="flex gap-2">
                <Input value={cliCommand} readOnly className="font-mono text-sm bg-secondary/50 border-border/50" />
                <Button
                  variant="outline"
                  className="border-border/50 hover:bg-secondary/50"
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
              <Button 
                onClick={() => {setOpen(false); setCliCommand(null); }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-5 py-4">
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Workspace Type</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setWorkspaceType("cloud")}
                    className={`flex items-center gap-3 p-4 rounded-lg border transition-all ${
                      workspaceType === "cloud"
                        ? "border-accent bg-primary/10"
                        : "border-border/50 hover:border-border hover:bg-secondary"
                    }`}
                  >
                    <Cloud className={`h-5 w-5 ${workspaceType === "cloud" ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="text-left">
                      <p className={`text-sm font-medium ${workspaceType === "cloud" ? "text-foreground" : ""}`}>Cloud Instance</p>
                      <p className="text-xs text-muted-foreground">Remote workspace</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceType("local")}
                    className={`flex items-center gap-3 p-4 rounded-lg border transition-all ${
                      workspaceType === "local"
                        ? "border-accent bg-primary/10"
                        : "border-border/50 hover:border-border hover:bg-secondary"
                    }`}
                  >
                    <Terminal className={`h-5 w-5 ${workspaceType === "local" ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="text-left">
                      <p className={`text-sm font-medium ${workspaceType === "local" ? "text-foreground" : ""}`}>Local Tunnel</p>
                      <p className="text-xs text-muted-foreground">Expose local server</p>
                    </div>
                  </button>
                </div>
              </div>

              {workspaceType === "local" ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="subdomain" className="text-sm font-medium">Subdomain</Label>
                    <Input
                      id="subdomain"
                      placeholder="my-app"
                      value={localSubdomain}
                      onChange={(e) => setLocalSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      className="bg-secondary/30 border-border/50 focus:border-accent"
                    />
                    <p className="text-xs text-muted-foreground">
                      Your tunnel will be available at: <span className="font-mono text-primary">{getWorkspaceDisplayUrl(localSubdomain || "my-app")}</span>
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="local-name" className="text-sm font-medium">Name (optional)</Label>
                    <Input
                      id="local-name"
                      placeholder="My Local App"
                      value={localName}
                      onChange={(e) => setLocalName(e.target.value)}
                      className="bg-secondary/30 border-border/50 focus:border-accent"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-sm font-medium">Agent Type</Label>
                    <Select value={selectedAgentTypeId} onValueChange={setSelectedAgentTypeId}>
                      <SelectTrigger className="bg-secondary/30 border-border/50">
                        <SelectValue placeholder="Select agent" />
                      </SelectTrigger>
                      <SelectContent>
                        {agentTypesData?.agentTypes?.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            <div className="flex items-center">
                              <Image 
                                src={getIcon(agent.name) || "/placeholder.svg"} 
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
                    <Label htmlFor="repo" className="text-sm font-medium">GitHub Repository URL</Label>
                    <Input
                      id="repo"
                      placeholder="https://github.com/username/repo"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      className="bg-secondary/30 border-border/50 focus:border-accent"
                    />
                  </div>

                  {subdomainPermissions?.canUseCustomSubdomain && (
                    <div className="grid gap-2">
                      <Label htmlFor="cloud-subdomain" className="text-sm font-medium">
                        Custom Subdomain <span className="text-muted-foreground font-normal">(optional)</span>
                      </Label>
                      <Input
                        id="cloud-subdomain"
                        placeholder="my-workspace"
                        value={cloudSubdomain}
                        onChange={(e) => setCloudSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                        className="bg-secondary/30 border-border/50 focus:border-accent"
                      />
                      <p className="text-xs text-muted-foreground">
                        {cloudSubdomain 
                          ? <>Your workspace will be available at: <span className="font-mono text-primary">{getWorkspaceDisplayUrl(cloudSubdomain)}</span></>
                          : "Leave empty for an auto-generated subdomain"
                        }
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Agent Type</Label>
                      <Select value={selectedAgentTypeId} onValueChange={setSelectedAgentTypeId}>
                        <SelectTrigger className="bg-secondary/30 border-border/50">
                          <SelectValue placeholder="Select agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {agentTypesData?.agentTypes?.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              <div className="flex items-center">
                                <Image 
                                  src={getIcon(agent.name) || "/placeholder.svg"} 
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
                      <Label className="text-sm font-medium">Cloud Provider</Label>
                      <Select value={selectedCloudProviderId} onValueChange={setSelectedCloudProviderId}>
                        <SelectTrigger className="bg-secondary/30 border-border/50">
                          <SelectValue placeholder="Select cloud" />
                        </SelectTrigger>
                        <SelectContent>
                          {cloudProviders.length > 0 ? (
                            cloudProviders.map((cloud) => (
                              <SelectItem key={cloud.id} value={cloud.id}>
                                <div className="flex items-center">
                                  <Image 
                                    src={getIcon(cloud.name) || "/placeholder.svg"} 
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
                      <Label className="text-sm font-medium">Region</Label>
                      <Select
                        value={selectedRegion}
                        onValueChange={setSelectedRegion}
                        disabled={availableRegions.length === 0}
                      >
                        <SelectTrigger className="bg-secondary/30 border-border/50">
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
                      <Label className="text-sm font-medium flex items-center gap-1">
                        Git Setup 
                        <Link href="/dashboard/integrations" className="text-primary hover:text-primary/80">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </Label>
                      <Select 
                        value={selectedGitInstallationId} 
                        onValueChange={setSelectedGitInstallationId}
                        disabled={installationsData?.installations && installationsData.installations.length === 0}
                      >
                        <SelectTrigger className="bg-secondary/30 border-border/50">
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

                    <div className="flex items-start gap-3 col-span-2 p-4 rounded-lg bg-secondary/30 border border-border/50">
                      <Checkbox
                        id="persistent"
                        checked={selectedPersistent}
                        onCheckedChange={(checked) => setSelectedPersistent(checked as boolean)}
                        className="mt-0.5 data-[state=checked]:bg-primary data-[state=checked]:border-accent"
                      />
                      <div className="grid gap-1">
                        <Label htmlFor="persistent" className="text-sm font-medium cursor-pointer">
                          Persistent Storage
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Keep your files and data between sessions. Disable for ephemeral workspaces.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setOpen(false)}
                className="border-border/50 hover:bg-secondary/50"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={createServiceMutation.isPending}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {createServiceMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create Instance
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

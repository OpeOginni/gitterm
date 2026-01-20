"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { queryClient, trpc } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ArrowUpRight, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getWorkspaceDisplayUrl } from "@/lib/utils";
import { isBillingEnabled } from "@gitterm/env/web";
import type { Route } from "next";
import {
  getIcon,
  type AgentType,
  type CloudProvider,
  type Region,
  type CreateInstanceResult,
} from "./types";

interface CreateCloudInstanceProps {
  onSuccess: (result: CreateInstanceResult) => void;
  onCancel: () => void;
}

export function CreateCloudInstance({ onSuccess, onCancel }: CreateCloudInstanceProps) {
  // Form state (null = use default)
  const [repoUrl, setRepoUrl] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [userAgentTypeId, setUserAgentTypeId] = useState<string | null>(null);
  const [userCloudProviderId, setUserCloudProviderId] = useState<string | null>(null);
  const [userRegionId, setUserRegionId] = useState<string | null>(null);
  const [userGitIntegrationId, setuserGitIntegrationId] = useState<string>("none");
  const [persistent, setPersistent] = useState(true);

  // Data fetching
  const { data: agentTypesData, isLoading: isLoadingAgentTypes } = useQuery(
    trpc.workspace.listAgentTypes.queryOptions(),
  );
  const { data: cloudProvidersData, isLoading: isLoadingCloudProviders } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true, nonSandboxOnly: true }),
  );
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());
  const { data: subdomainPermissions } = useQuery(
    trpc.workspace.getSubdomainPermissions.queryOptions(),
  );

  // Derived selections (user choice or first available)
  const selectedCloudProviderId =
    userCloudProviderId ?? cloudProvidersData?.cloudProviders[0]?.id ?? "";
  const selectedAgentTypeId = userAgentTypeId ?? agentTypesData?.agentTypes[0]?.id ?? "";

  const availableRegions = useMemo((): Region[] => {
    if (!selectedCloudProviderId) return [];
    const provider = cloudProvidersData?.cloudProviders.find(
      (p) => p.id === selectedCloudProviderId,
    );
    return (provider?.regions ?? []) as Region[];
  }, [selectedCloudProviderId, cloudProvidersData?.cloudProviders]);

  const selectedRegion = useMemo(() => {
    if (userRegionId && availableRegions.some((r) => r.id === userRegionId)) {
      return userRegionId;
    }
    return availableRegions[0]?.id ?? "";
  }, [userRegionId, availableRegions]);

  const handleCloudProviderChange = (providerId: string) => {
    setUserCloudProviderId(providerId);
    setUserRegionId(null);
  };

  // Mutation
  const { mutateAsync: createWorkspace, isPending: isSubmitting } = useMutation(
    trpc.workspace.createWorkspace.mutationOptions({
      onSuccess: (data) => {
        toast.success("Workspace is provisioning");
        queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
        onSuccess({
          type: "workspace",
          workspaceId: data.workspace.id,
          userId: data.workspace.userId,
        });
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to create workspace: ${error.message}`);
      },
    }),
  );

  const isValid = !!(repoUrl && selectedAgentTypeId && selectedCloudProviderId && selectedRegion);

  const handleSubmit = async () => {
    if (!isValid) {
      toast.error("Please fill in all required fields.");
      return;
    }

    await createWorkspace({
      name: repoUrl.split("/").pop() || "new-workspace",
      repo: repoUrl,
      agentTypeId: selectedAgentTypeId,
      cloudProviderId: selectedCloudProviderId,
      regionId: selectedRegion,
      gitIntegrationId: userGitIntegrationId === "none" ? undefined : userGitIntegrationId,
      persistent,
      subdomain: subdomain || undefined,
    });
  };

  const integrations = installationsData?.installations;

  return (
    <>
      <div className="grid gap-5 py-4">
        {/* Repository URL */}
        <div className="grid gap-2">
          <Label htmlFor="repo" className="text-sm font-medium">
            GitHub Repository URL
          </Label>
          <Input
            id="repo"
            placeholder="https://github.com/username/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="bg-secondary/30 border-border/50 focus:border-accent"
          />
        </div>

        {/* Custom Subdomain */}
        <div className="grid gap-2">
          <Label htmlFor="cloud-subdomain" className="text-sm font-medium">
            Custom Subdomain <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="cloud-subdomain"
            placeholder="my-workspace"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            className="bg-secondary/30 border-border/50 focus:border-accent"
            disabled={!subdomainPermissions?.canUseCustomCloudSubdomain}
          />
          <p className="text-xs text-muted-foreground">
            {subdomainPermissions?.canUseCustomCloudSubdomain ? (
              subdomain ? (
                <>
                  Your workspace will be available at:{" "}
                  <span className="font-mono text-primary">
                    {getWorkspaceDisplayUrl(subdomain)}
                  </span>
                </>
              ) : (
                "Leave empty for an auto-generated subdomain"
              )
            ) : (
              <span className="flex items-center gap-1 flex-wrap">
                A subdomain will be generated automatically.
                {isBillingEnabled() && (
                  <Link
                    href={"/pricing" as Route}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    <Sparkles className="h-3 w-3" />
                    Upgrade for custom subdomains
                  </Link>
                )}
              </span>
            )}
          </p>
        </div>

        {/* Agent Type & Cloud Provider */}
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Agent Type</Label>
            <Select value={selectedAgentTypeId} onValueChange={setUserAgentTypeId}>
              <SelectTrigger className="bg-secondary/30 border-border/50">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              {isLoadingAgentTypes ? (
                <SelectContent>
                  <SelectItem value="loading" disabled>
                    Loading agent types...
                  </SelectItem>
                </SelectContent>
              ) : (
                <SelectContent>
                  {agentTypesData?.agentTypes && agentTypesData.agentTypes.length > 0 ? (
                    agentTypesData.agentTypes.map((agent) => (
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
                    ))
                  ) : (
                    <SelectItem value="no-agent-types" disabled>
                      No agent types found
                    </SelectItem>
                  )}
                </SelectContent>
              )}
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-sm font-medium">Cloud Provider</Label>
            <Select value={selectedCloudProviderId} onValueChange={handleCloudProviderChange}>
              <SelectTrigger className="bg-secondary/30 border-border/50">
                <SelectValue placeholder="Select cloud" />
              </SelectTrigger>
              {isLoadingCloudProviders ? (
                <SelectContent>
                  <SelectItem value="loading" disabled>
                    Loading cloud providers...
                  </SelectItem>
                </SelectContent>
              ) : (
                <SelectContent>
                  {cloudProvidersData?.cloudProviders &&
                  cloudProvidersData.cloudProviders.length > 0 ? (
                    cloudProvidersData.cloudProviders.map((cloud) => (
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
                    <SelectItem value="no-cloud-providers" disabled>
                      No cloud providers found
                    </SelectItem>
                  )}
                </SelectContent>
              )}
            </Select>
          </div>
        </div>

        {/* Region & Git Setup */}
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Region</Label>
            <Select
              value={selectedRegion}
              onValueChange={setUserRegionId}
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
              value={userGitIntegrationId}
              onValueChange={setuserGitIntegrationId}
              disabled={integrations && integrations.length === 0}
            >
              <SelectTrigger className="bg-secondary/30 border-border/50">
                <SelectValue
                  placeholder={
                    integrations && integrations.length > 0
                      ? "Select git integration"
                      : "No git integrations found"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <div className="flex items-center">None</div>
                </SelectItem>
                {integrations?.map((installation) => (
                  <SelectItem
                    key={installation.git_integration.id}
                    value={installation.git_integration.id}
                  >
                    <div className="flex items-center">
                      <Image
                        src="/github.svg"
                        alt="GitHub"
                        width={16}
                        height={16}
                        className="mr-2 h-4 w-4"
                      />
                      {installation.git_integration.providerAccountLogin}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Persistent Storage */}
          <div className="flex items-start gap-3 col-span-2 p-4 rounded-lg bg-secondary/30 border border-border/50">
            <Checkbox
              id="persistent"
              checked={persistent}
              onCheckedChange={(checked) => setPersistent(checked as boolean)}
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
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="border-border/50 hover:bg-secondary/50"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !isValid}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isSubmitting ? (
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
  );
}

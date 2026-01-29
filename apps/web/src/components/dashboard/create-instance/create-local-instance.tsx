"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { queryClient, trpc } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ArrowUpRight, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAgentConnectCommand, getWorkspaceDisplayUrl } from "@/lib/utils";
import { isBillingEnabled } from "@gitterm/env/web";
import type { Route } from "next";
import { getIcon, type CreateInstanceResult } from "./types";

interface CreateLocalInstanceProps {
  onSuccess: (result: CreateInstanceResult) => void;
  onCancel: () => void;
}

export function CreateLocalInstance({ onSuccess, onCancel }: CreateLocalInstanceProps) {
  // Form state (null = use default)
  const [subdomain, setSubdomain] = useState("");
  const [name, setName] = useState("");
  const [userAgentTypeId, setUserAgentTypeId] = useState<string | null>(null);

  // Data fetching
  const { data: agentTypesData, isLoading: isLoadingAgentTypes } = useQuery(
    trpc.workspace.listAgentTypes.queryOptions({ serverOnly: true }),
  );
  const { data: localProvidersData, isLoading: isLoadingLocalProviders } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ localOnly: true }),
  );
  const { data: subdomainPermissions } = useQuery(
    trpc.workspace.getSubdomainPermissions.queryOptions(),
  );

  // Derived selections
  const selectedAgentTypeId = userAgentTypeId ?? agentTypesData?.agentTypes[0]?.id ?? "";
  const selectedRegion = localProvidersData?.cloudProviders[0]?.regions?.[0]?.id ?? "";

  // Mutation
  const createWorkspaceMutation = useMutation(
    trpc.workspace.createWorkspace.mutationOptions({
      onSuccess: (data) => {
        toast.success("Local tunnel created successfully");
        queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
        onSuccess({
          type: "tunnel",
          command: getAgentConnectCommand(data.workspace.id),
        });
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to create tunnel: ${error.message}`);
      },
    }),
  );

  const isValid = !!(
    selectedAgentTypeId &&
    localProvidersData?.cloudProviders[0] &&
    selectedRegion
  );
  const isSubmitting = createWorkspaceMutation.isPending;

  const handleSubmit = async () => {
    if (!selectedAgentTypeId) {
      toast.error("Please select an agent type.");
      return;
    }
    if (!localProvidersData?.cloudProviders[0] || !selectedRegion) {
      toast.error("Local provider not available. Please try again.");
      return;
    }

    await createWorkspaceMutation.mutateAsync({
      subdomain: subdomain,
      name: name,
      agentTypeId: selectedAgentTypeId,
      cloudProviderId: localProvidersData.cloudProviders[0].id,
      regionId: selectedRegion,
      persistent: false,
    });
  };

  if(!localProvidersData?.cloudProviders[0]?.isEnabled) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg bg-secondary/30 border border-border/50 my-4">
          <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-center mb-2">Local Tunnel Not Enabled</p>
          <p className="text-xs text-muted-foreground text-center mb-4">
            Reach out to an administrator to enable local tunnels.
          </p>
        </div>
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onCancel}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <div className="grid gap-5 py-4">
        {/* Subdomain */}
        <div className="grid gap-2">
          <Label htmlFor="subdomain" className="text-sm font-medium">
            Subdomain
          </Label>
          <Input
            id="subdomain"
            placeholder="my-app"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            disabled={!subdomainPermissions?.canUseCustomTunnelSubdomain}
          />
          <p className="text-xs text-muted-foreground">
            {subdomainPermissions?.canUseCustomTunnelSubdomain ? (
              <>
                Your tunnel will be available at:{" "}
                <span className="font-mono text-primary">
                  {getWorkspaceDisplayUrl(subdomain || "my-app")}
                </span>
              </>
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

        {/* Name */}
        <div className="grid gap-2">
          <Label htmlFor="local-name" className="text-sm font-medium">
            Name (optional)
          </Label>
          <Input
            id="local-name"
            placeholder="My Local App"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Agent Type */}
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Agent Type</Label>
          <Select value={selectedAgentTypeId} onValueChange={setUserAgentTypeId}>
            <SelectTrigger>
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
          <p className="text-xs text-muted-foreground">
            Choose which agent you are going to run in your local environment
          </p>
        </div>
      </div>

      <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !isValid}
          className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Create Tunnel
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

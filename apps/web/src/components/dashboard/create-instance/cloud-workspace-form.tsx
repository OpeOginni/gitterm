"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, Sparkles } from "lucide-react";
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
import { getWorkspaceDisplayUrl } from "@/lib/utils";
import { isBillingEnabled } from "@gitterm/env/web";
import type { Route } from "next";
import { AgentTypeSelect } from "./agent-type-select";
import {
  getIcon,
  type AgentType,
  type CloudProvider,
  type Region,
  type GitInstallation,
  type SubdomainPermissions,
} from "./types";

interface CloudWorkspaceFormProps {
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  subdomain: string;
  onSubdomainChange: (value: string) => void;
  selectedAgentTypeId: string;
  onAgentTypeChange: (value: string) => void;
  agentTypes: AgentType[];
  selectedCloudProviderId: string;
  onCloudProviderChange: (value: string) => void;
  cloudProviders: CloudProvider[];
  selectedRegion: string;
  onRegionChange: (value: string) => void;
  availableRegions: Region[];
  selectedGitInstallationId: string | undefined;
  onGitInstallationChange: (value: string) => void;
  installations: GitInstallation[] | undefined;
  persistent: boolean;
  onPersistentChange: (value: boolean) => void;
  subdomainPermissions: SubdomainPermissions | undefined;
}

export function CloudWorkspaceForm({
  repoUrl,
  onRepoUrlChange,
  subdomain,
  onSubdomainChange,
  selectedAgentTypeId,
  onAgentTypeChange,
  agentTypes,
  selectedCloudProviderId,
  onCloudProviderChange,
  cloudProviders,
  selectedRegion,
  onRegionChange,
  availableRegions,
  selectedGitInstallationId,
  onGitInstallationChange,
  installations,
  persistent,
  onPersistentChange,
  subdomainPermissions,
}: CloudWorkspaceFormProps) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="repo" className="text-sm font-medium">GitHub Repository URL</Label>
        <Input
          id="repo"
          placeholder="https://github.com/username/repo"
          value={repoUrl}
          onChange={(e) => onRepoUrlChange(e.target.value)}
          className="bg-secondary/30 border-border/50 focus:border-accent"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="cloud-subdomain" className="text-sm font-medium">
          Custom Subdomain <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="cloud-subdomain"
          placeholder="my-workspace"
          value={subdomain}
          onChange={(e) => onSubdomainChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          className="bg-secondary/30 border-border/50 focus:border-accent"
          disabled={!subdomainPermissions?.canUseCustomCloudSubdomain}
        />
        <p className="text-xs text-muted-foreground">
          {subdomainPermissions?.canUseCustomCloudSubdomain ? (
            subdomain
              ? <>Your workspace will be available at: <span className="font-mono text-primary">{getWorkspaceDisplayUrl(subdomain)}</span></>
              : "Leave empty for an auto-generated subdomain"
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

      <div className="grid grid-cols-2 gap-4">
        <AgentTypeSelect
          value={selectedAgentTypeId}
          onChange={onAgentTypeChange}
          agentTypes={agentTypes}
        />

        <div className="grid gap-2">
          <Label className="text-sm font-medium">Cloud Provider</Label>
          <Select value={selectedCloudProviderId} onValueChange={onCloudProviderChange}>
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
            value={selectedRegion || availableRegions[0]?.id || ""}
            onValueChange={onRegionChange}
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
            onValueChange={onGitInstallationChange}
            disabled={installations && installations.length === 0}
          >
            <SelectTrigger className="bg-secondary/30 border-border/50">
              <SelectValue placeholder={installations && installations.length > 0 ? "Select git installation" : "No git installations found"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" key="none">
                <div className="flex items-center">
                  None
                </div>
              </SelectItem>
              {installations && installations.length > 0 && (
                installations.map((installation) => (
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
            checked={persistent}
            onCheckedChange={(checked) => onPersistentChange(checked as boolean)}
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
  );
}

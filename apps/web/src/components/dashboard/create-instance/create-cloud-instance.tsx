"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { queryClient, trpc } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Key, KeyRound, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, getWorkspaceDisplayUrl } from "@/lib/utils";
import { isBillingEnabled } from "@gitterm/env/web";
import type { Route } from "next";
import {
  getIcon,
  type AgentType,
  type CloudProvider,
  type Region,
  type CreateInstanceResult,
  type WorkspaceProfile,
} from "./types";
import { GitHubRepositoryBranchField } from "./github-repository-branch-field";
import { normalizeGitHubRepositoryUrl } from "./github-repository-utils";

interface CreateCloudInstanceProps {
  onSuccess: (result: CreateInstanceResult) => void;
  onCancel: () => void;
}

export function CreateCloudInstance({ onSuccess, onCancel }: CreateCloudInstanceProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [userAgentTypeId, setUserAgentTypeId] = useState<string | null>(null);
  const [userCloudProviderId, setUserCloudProviderId] = useState<string | null>(null);
  const [userRegionId, setUserRegionId] = useState<string | null>(null);
  const [userGitIntegrationId, setuserGitIntegrationId] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [workspaceProfile, setWorkspaceProfile] = useState<WorkspaceProfile>("standard");

  // Data fetching
  const { data: agentTypesData, isLoading: isLoadingAgentTypes } = useQuery(
    trpc.workspace.listAgentTypes.queryOptions(),
  );
  const { data: cloudProvidersData, isLoading: isLoadingCloudProviders } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
  );
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());
  const { data: subdomainPermissions } = useQuery(
    trpc.workspace.getSubdomainPermissions.queryOptions(),
  );
  const { data: sshPublicKeyData } = useQuery(trpc.user.getSshPublicKey.queryOptions());
  const { data: credentialsData } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );
  const activeCredentialCount = useMemo(
    () => (credentialsData?.credentials ?? []).filter((c) => c.isActive).length,
    [credentialsData?.credentials],
  );

  // AWS providers are region-scoped: multiple cloud_provider rows share
  // providerKey === "aws" and each is pinned to one region. For the UI we
  // group them under a single "AWS" cloud entry so users pick AWS + region,
  // and the selected region resolves back to a specific provider row.
  const cloudProviders = cloudProvidersData?.cloudProviders ?? [];

  const awsProviders = useMemo(
    () => cloudProviders.filter((p) => p.providerKey === "aws"),
    [cloudProviders],
  );

  const nonAwsProviders = useMemo(
    () => cloudProviders.filter((p) => p.providerKey !== "aws"),
    [cloudProviders],
  );

  // "Group key" identifies a top-level cloud entry: either an individual
  // provider id (non-AWS) or the synthetic "aws" group.
  type CloudGroupKey = string; // "aws" | <providerId>

  const hasAwsGroup = awsProviders.length > 0;

  const defaultGroupKey: CloudGroupKey | "" = hasAwsGroup
    ? "aws"
    : (nonAwsProviders[0]?.id ?? "");

  const [userCloudGroupKey, setUserCloudGroupKey] = useState<CloudGroupKey | null>(null);
  const selectedCloudGroupKey = userCloudGroupKey ?? defaultGroupKey;
  const isAwsGroup = selectedCloudGroupKey === "aws";

  // Resolve the actual provider row for the currently selected group + region.
  const selectedCloudProvider = useMemo((): CloudProvider | null => {
    if (isAwsGroup) {
      // Prefer the explicitly chosen AWS region-provider, otherwise default to
      // the first AWS provider available.
      const matched = awsProviders.find((p) => p.id === userCloudProviderId);
      return ((matched ?? awsProviders[0]) as CloudProvider | undefined) ?? null;
    }
    return (
      (nonAwsProviders.find((p) => p.id === selectedCloudGroupKey) as CloudProvider | undefined) ??
      null
    );
  }, [isAwsGroup, awsProviders, nonAwsProviders, selectedCloudGroupKey, userCloudProviderId]);

  const selectedCloudProviderId = selectedCloudProvider?.id ?? "";

  const availableRegions = useMemo((): Region[] => {
    if (isAwsGroup) {
      // Each AWS provider is pinned to one region. Surface every AWS provider's
      // region as a selectable region; selecting one switches the provider row.
      return awsProviders.flatMap(
        (provider) =>
          provider.regions?.map((r) => ({
            id: `${provider.id}::${r.id}`,
            name: r.name,
          })) ?? [],
      );
    }
    return (selectedCloudProvider?.regions ?? []) as Region[];
  }, [isAwsGroup, awsProviders, selectedCloudProvider]);

  const shouldShowRegionSelector = isAwsGroup
    ? awsProviders.length > 0
    : !!selectedCloudProvider?.supportsRegions &&
      !!selectedCloudProvider?.allowUserRegionSelection &&
      availableRegions.length > 0;

  const availableAgents = useMemo((): AgentType[] => {
    const agents = agentTypesData?.agentTypes ?? [];
    if (!selectedCloudProvider) return agents;
    if ((selectedCloudProvider as any).supportServerOnly) {
      return agents.filter((agent) => agent.serverOnly);
    }
    return agents;
  }, [selectedCloudProvider, agentTypesData?.agentTypes]);

  const selectedAgentTypeId = userAgentTypeId ?? availableAgents[0]?.id ?? "";

  const selectedRegion = useMemo(() => {
    if (isAwsGroup) {
      // For AWS, the composite "providerId::regionId" doubles as the picker
      // value; we resolve the provider row separately.
      const fallback = awsProviders[0]?.regions?.[0];
      const fallbackComposite = fallback
        ? `${awsProviders[0].id}::${fallback.id}`
        : "";
      if (userRegionId && availableRegions.some((r) => r.id === userRegionId)) {
        return userRegionId;
      }
      return fallbackComposite;
    }

    if (userRegionId && availableRegions.some((r) => r.id === userRegionId)) {
      return userRegionId;
    }
    return availableRegions[0]?.id ?? "";
  }, [isAwsGroup, awsProviders, userRegionId, availableRegions]);

  const canEnableEditorAccess =
    !!selectedCloudProvider?.editorAccessSupport?.supported &&
    availableAgents.some((agent) => agent.id === selectedAgentTypeId && agent.serverOnly) &&
    (selectedCloudProvider?.providerKey === "daytona" || sshPublicKeyData?.hasPublicKey === true);

  const requiresUserSshKey = selectedCloudProvider?.providerKey !== "daytona";
  const selectedAgent = availableAgents.find((agent) => agent.id === selectedAgentTypeId);

  const handleCloudGroupChange = (groupKey: CloudGroupKey) => {
    setUserCloudGroupKey(groupKey);
    setUserRegionId(null);
    if (groupKey === "aws") {
      // Default to first AWS provider; region picker will refine selection.
      setUserCloudProviderId(awsProviders[0]?.id ?? null);
    } else {
      setUserCloudProviderId(groupKey);
    }
  };

  const handleRegionChange = (regionValue: string) => {
    setUserRegionId(regionValue);
    if (isAwsGroup) {
      // AWS region values are "<providerId>::<regionId>" so we can route the
      // selection back to the right region-provider row.
      const [providerId] = regionValue.split("::");
      if (providerId) {
        setUserCloudProviderId(providerId);
      }
    }
  };

  const handleProfileChange = (enabled: boolean) => {
    setWorkspaceProfile(enabled ? "ssh-enabled" : "standard");
  };

  // Mutation
  const { mutateAsync: createWorkspace, isPending: isSubmitting } = useMutation(
    trpc.workspace.createWorkspace.mutationOptions({
      onSuccess: (data) => {
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

  const isValid = !!(
    repoUrl &&
    selectedAgentTypeId &&
    selectedCloudProviderId &&
    (!shouldShowRegionSelector || selectedRegion)
  );

  const handleSubmit = async () => {
    if (!isValid) {
      toast.error("Please fill in all required fields.");
      return;
    }

    if (shouldShowRegionSelector && !selectedRegion) {
      toast.error(
        "No default region is configured for this provider. Ask an admin to add one or enable region support.",
      );
      return;
    }

    const normalizedRepoUrl = normalizeGitHubRepositoryUrl(repoUrl);
    const trimmedBranch = branch.trim();

    // Resolve effective providerId + regionId. For AWS the composite value
    // "<providerId>::<regionId>" splits into the right region-provider row.
    let resolvedCloudProviderId = selectedCloudProviderId;
    let resolvedRegionId: string | undefined = undefined;

    if (isAwsGroup && selectedRegion) {
      const [providerId, regionId] = selectedRegion.split("::");
      if (providerId) resolvedCloudProviderId = providerId;
      if (regionId) resolvedRegionId = regionId;
    } else if (shouldShowRegionSelector) {
      resolvedRegionId = selectedRegion;
    }

    await createWorkspace({
      name: normalizedRepoUrl.split("/").pop() || "new-workspace",
      repo: normalizedRepoUrl,
      branch: trimmedBranch || undefined,
      agentTypeId: selectedAgentTypeId,
      cloudProviderId: resolvedCloudProviderId,
      regionId: resolvedRegionId,
      gitIntegrationId: selectedGitIntegrationId === "none" ? undefined : selectedGitIntegrationId,
      persistent,
      subdomain: subdomain || undefined,
      workspaceProfile,
    });
  };

  useEffect(() => {
    if (workspaceProfile === "ssh-enabled" && !canEnableEditorAccess) {
      setWorkspaceProfile("standard");
    }
  }, [workspaceProfile, canEnableEditorAccess]);

  const integrations = installationsData?.installations;
  const hasIntegrations = integrations && integrations.length > 0;
  const selectedGitIntegrationId =
    userGitIntegrationId ?? integrations?.[0]?.git_integration.id ?? "none";

  const selectedGitIntegration = useMemo(() => {
    if (!integrations || selectedGitIntegrationId === "none") {
      return null;
    }
    const match = integrations.find(
      (installation) => installation.git_integration.id === selectedGitIntegrationId,
    );
    if (!match) {
      return null;
    }
    return {
      gitIntegrationId: match.git_integration.id,
      providerInstallationId: match.git_integration.providerInstallationId,
      label: match.git_integration.providerAccountLogin,
    };
  }, [integrations, selectedGitIntegrationId]);

  return (
    <>
      <div className="grid gap-4 py-4">
        {/* ── 1. Repo + Branch (top priority) ── */}
        <GitHubRepositoryBranchField
          repoUrl={repoUrl}
          branch={branch}
          onRepoUrlChange={setRepoUrl}
          onBranchChange={setBranch}
          integration={selectedGitIntegration}
          disabled={isSubmitting}
        />

        {/* ── 2. Subdomain ── */}
        <div className="grid gap-1.5">
          <Label htmlFor="cloud-subdomain" className="text-xs font-medium text-muted-foreground">
            Subdomain <span className="font-normal text-muted-foreground/50">(optional)</span>
          </Label>
          <Input
            id="cloud-subdomain"
            placeholder="my-workspace"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            disabled={!subdomainPermissions?.canUseCustomCloudSubdomain}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground/60">
            {subdomainPermissions?.canUseCustomCloudSubdomain ? (
              subdomain ? (
                <>
                  Available at{" "}
                  <span className="font-mono text-primary">
                    {getWorkspaceDisplayUrl(subdomain)}
                  </span>
                </>
              ) : (
                "Auto-generated if left empty"
              )
            ) : (
              <span className="inline-flex items-center gap-1 flex-wrap">
                Auto-generated.
                {isBillingEnabled() && (
                  <Link
                    href={"/pricing" as Route}
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    Upgrade to Pro
                  </Link>
                )}
              </span>
            )}
          </p>
        </div>

        {/* ── 3. Agent + Cloud (+ Region) ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={selectedAgentTypeId} onValueChange={setUserAgentTypeId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              {isLoadingAgentTypes ? (
                <SelectContent>
                  <SelectItem value="loading" disabled>
                    Loading...
                  </SelectItem>
                </SelectContent>
              ) : (
                <SelectContent>
                  {availableAgents.length > 0 ? (
                    availableAgents.map((agent) => (
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
                    <SelectItem value="none" disabled>
                      No agents found
                    </SelectItem>
                  )}
                </SelectContent>
              )}
            </Select>
          </div>

          <div className="grid gap-1.5 min-w-0">
            <Label className="text-xs font-medium text-muted-foreground">
              {shouldShowRegionSelector ? "Cloud / Region" : "Cloud"}
            </Label>
            <div className="flex gap-2 min-w-0">
              <Select value={selectedCloudGroupKey} onValueChange={handleCloudGroupChange}>
                <SelectTrigger className="h-9 shrink-0">
                  <SelectValue placeholder="Select cloud" />
                </SelectTrigger>
                {isLoadingCloudProviders ? (
                  <SelectContent>
                    <SelectItem value="loading" disabled>
                      Loading...
                    </SelectItem>
                  </SelectContent>
                ) : (
                  <SelectContent>
                    {hasAwsGroup && (
                      <SelectItem value="aws">
                        <div className="flex items-center">
                          <Image
                            src="/ECS.svg"
                            alt="AWS"
                            width={16}
                            height={16}
                            className="mr-2 h-4 w-4"
                          />
                          AWS
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                            ×{awsProviders.length}
                          </span>
                        </div>
                      </SelectItem>
                    )}
                    {nonAwsProviders.length > 0 ? (
                      nonAwsProviders.map((cloud) => (
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
                    ) : !hasAwsGroup ? (
                      <SelectItem value="none" disabled>
                        No providers
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                )}
              </Select>

              {shouldShowRegionSelector ? (
                <Select
                  value={selectedRegion}
                  onValueChange={handleRegionChange}
                  disabled={availableRegions.length === 0}
                >
                  <SelectTrigger className="h-9 min-w-0 [&>span]:truncate">
                    <SelectValue
                      placeholder={availableRegions.length > 0 ? "Region" : "No regions"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRegions.map((region) => (
                      <SelectItem key={region.id} value={region.id}>
                        {region.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── 3b. API Credentials indicator ── */}
        <div className="flex items-center justify-between rounded-md border border-border/30 bg-secondary/10 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Key className="h-3.5 w-3.5" />
            <span>
              <span className="font-medium text-foreground">{activeCredentialCount}</span> API{" "}
              {activeCredentialCount === 1 ? "credential" : "credentials"} configured
            </span>
          </div>
          <Link
            href={"/dashboard/settings" as Route}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            Manage
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        {/* ── 3. GitHub Connection ── */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help decoration-dotted underline-offset-4 hover:underline">
                  GitHub Connection
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" sideOffset={6} className="max-w-xs text-xs">
                Connect a GitHub account to enable commit, push, fork and private repo access.
              </TooltipContent>
            </Tooltip>
            <Link href="/dashboard/integrations" className="text-primary hover:text-foreground/70">
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Label>
          <Select
            value={selectedGitIntegrationId}
            onValueChange={setuserGitIntegrationId}
            disabled={!hasIntegrations}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={hasIntegrations ? "Select account" : "No integrations"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (public repos only)</SelectItem>
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

        {/* ── 4. SSH Editor Access ── */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="editor-access"
            checked={workspaceProfile === "ssh-enabled"}
            onCheckedChange={(checked) => handleProfileChange(checked === true)}
            disabled={!canEnableEditorAccess}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-accent"
          />
          <Label
            htmlFor="editor-access"
            className={cn(
              "group flex flex-1 items-center gap-2 text-xs text-muted-foreground",
              canEnableEditorAccess ? "cursor-pointer" : "cursor-default text-muted-foreground/75",
            )}
          >
            <span>Editor Access (SSH)</span>
            {canEnableEditorAccess ? (
              <>
                <span className="text-muted-foreground/40">&mdash; opens in</span>
                <span className="flex items-center gap-2 px-1.5 py-0.5 transition-colors">
                  {[
                    { src: "/vscode.svg", alt: "VS Code" },
                    { src: "/cursor.svg", alt: "Cursor" },
                    { src: "/zed.svg", alt: "Zed" },
                    { src: "/neovim.svg", alt: "Neovim" },
                  ].map((editor) => (
                    <Image
                      key={editor.src}
                      src={editor.src}
                      alt={editor.alt}
                      width={11}
                      height={11}
                      className={cn(
                        "transition-opacity group-hover:opacity-100",
                        workspaceProfile === "ssh-enabled" ? "opacity-100" : "opacity-60",
                      )}
                    />
                  ))}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground/70">
                &mdash;{" "}
                {!selectedCloudProvider?.editorAccessSupport?.supported
                  ? "not supported by this provider"
                  : !selectedAgent?.serverOnly
                    ? "requires a server agent type"
                    : "unavailable"}
              </span>
            )}
          </Label>
        </div>

        {requiresUserSshKey &&
          !sshPublicKeyData?.hasPublicKey &&
          selectedAgent?.serverOnly &&
          selectedCloudProvider?.editorAccessSupport?.supported &&
          workspaceProfile === "ssh-enabled" && (
            <Link
              href={"/dashboard/settings" as Route}
              className="inline-flex items-center gap-1.5 text-[11px] text-amber-400/80 hover:text-amber-400"
            >
              <KeyRound className="h-3 w-3" />
              Add SSH key in Settings
            </Link>
          )}

        {/* ── 5. Persistent storage ── */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="persistent"
            checked={persistent}
            onCheckedChange={(checked) => setPersistent(checked as boolean)}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-accent"
          />
          <Label htmlFor="persistent" className="text-xs cursor-pointer text-muted-foreground">
            Persistent storage
            <span className="text-muted-foreground/50"> &mdash; keep files between sessions</span>
          </Label>
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
              Create Instance
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

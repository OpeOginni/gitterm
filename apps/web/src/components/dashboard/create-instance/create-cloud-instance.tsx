"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { queryClient, trpc } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Blocks, ChevronDown, Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { HelpHint } from "@/components/ui/help-hint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, getWorkspaceDisplayUrl } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { analyticsErrorCode, type WorkspaceProperties } from "@gitterm/analytics/policy";
import { authClient } from "@/lib/auth-client";
import { isBillingEnabled } from "@gitterm/env/web";
import type { Route } from "next";
import {
  formatHourlyPrice,
  formatMachineSize,
  getIcon,
  type AgentType,
  type CloudProvider,
  type Region,
  type CreateInstanceResult,
  type WorkspaceProfile,
} from "./types";
import { GitHubRepositoryBranchField } from "./github-repository-branch-field";
import { ModelProviderEmpty, ModelProviderPicker } from "./model-provider-picker";
import { useBillingAccount } from "@/lib/billing";
import { normalizeGitHubRepositoryUrl } from "./github-repository-utils";

interface CreateCloudInstanceProps {
  onSuccess: (result: CreateInstanceResult) => void;
  onCancel: () => void;
}

interface WorkspaceCredential {
  id: string;
  providerName: string;
  providerDisplayName: string;
  logicalProviderKey: string;
  authType: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
}

export function CreateCloudInstance({ onSuccess, onCancel }: CreateCloudInstanceProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [userAgentTypeId, setUserAgentTypeId] = useState<string | null>(null);
  const [userCloudProviderId, setUserCloudProviderId] = useState<string | null>(null);
  const [userRegionId, setUserRegionId] = useState<string | null>(null);
  const [userMachineProfileId, setUserMachineProfileId] = useState<string | null>(null);
  const [awsProfileSelection, setAwsProfileSelection] = useState<{
    providerId: string;
    id: string;
  } | null>(null);
  const [userGitIntegrationId, setuserGitIntegrationId] = useState<string | null>(null);
  const [googleCloudIntegrationId, setGoogleCloudIntegrationId] = useState("none");
  const [mcpConnectionIds, setMcpConnectionIds] = useState<string[]>([]);
  const [showIntegrations, setShowIntegrations] = useState(false);
  // Editor (SSH) access is no longer offered here; every workspace uses the standard profile.
  const workspaceProfile: WorkspaceProfile = "standard";

  // Data fetching -- staleTime keeps the prefetched cache from refetching on
  // open so the dialog renders fully populated without a flicker or resize.
  const STALE_TIME = 5 * 60 * 1000;
  const { data: agentTypesData, isLoading: isLoadingAgentTypes } = useQuery({
    ...trpc.workspace.listAgentTypes.queryOptions(),
    staleTime: STALE_TIME,
  });
  const { data: cloudProvidersData, isLoading: isLoadingCloudProviders } = useQuery({
    ...trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
    staleTime: STALE_TIME,
  });
  const { data: installationsData } = useQuery({
    ...trpc.workspace.listUserInstallations.queryOptions(),
    staleTime: STALE_TIME,
  });
  const { data: githubAvailability } = useQuery({
    ...trpc.github.appAvailability.queryOptions(),
    staleTime: STALE_TIME,
  });
  const { data: googleCloudIntegrations = [] } = useQuery({
    ...trpc.googleCloud.list.queryOptions(),
    staleTime: STALE_TIME,
  });
  const { data: googleCloudAvailability } = useQuery({
    ...trpc.googleCloud.availability.queryOptions(),
    staleTime: STALE_TIME,
  });
  const { data: integrationCatalog } = useQuery({
    ...trpc.integrations.list.queryOptions(),
    staleTime: STALE_TIME,
  });
  const isIntegrationEnabled = (key: string) =>
    integrationCatalog?.some((integration) => integration.key === key && integration.enabled) ===
    true;
  const canAddGoogleCloud =
    isIntegrationEnabled("google") && googleCloudAvailability?.available === true;
  // The picker shows only once the user has an identity to pick.
  const isGoogleCloudAvailable = canAddGoogleCloud && googleCloudIntegrations.length > 0;
  const { data: connections = [], error: connectionsError } = useQuery(
    trpc.integrations.connections.list.queryOptions(),
  );
  const mcpConnections = connections.filter(
    (connection) => connection.integration === "mcp" || connection.integration === "executor",
  );
  const hasConnection = (key: string) =>
    connections.some((connection) => connection.integration === key);
  // Enabled integrations the user hasn't set up yet; each links to Integrations.
  const integrationSetups = [
    {
      key: "google",
      name: "Google Cloud",
      description: "Keyless gcloud access",
      icon: <Image src="/google-cloud.svg" alt="" width={16} height={16} />,
      show: canAddGoogleCloud && !isGoogleCloudAvailable,
    },
    {
      key: "executor",
      name: "Executor",
      description: "Your Executor tool catalog through one connection",
      icon: <Image src="/executor.png" alt="" width={16} height={16} />,
      show: isIntegrationEnabled("executor") && !connectionsError && !hasConnection("executor"),
    },
    {
      key: "mcp",
      name: "MCP servers",
      description: "Remote MCP tools your agent connects to directly",
      icon: <Blocks className="size-4 text-fg-2" />,
      show: isIntegrationEnabled("mcp") && !connectionsError && !hasConnection("mcp"),
    },
  ].filter((setup) => setup.show);
  const integrationTypes = [
    canAddGoogleCloud ? "Google Cloud" : null,
    isIntegrationEnabled("executor") || hasConnection("executor") ? "Executor" : null,
    isIntegrationEnabled("mcp") || hasConnection("mcp") ? "MCP servers" : null,
  ].filter(Boolean);
  const { data: defaultProviderData } = useQuery({
    ...trpc.user.getDefaultCloudProvider.queryOptions(),
    staleTime: STALE_TIME,
  });
  const defaultCloudProviderId = defaultProviderData?.cloudProviderId ?? null;
  const { data: subdomainPermissions } = useQuery({
    ...trpc.workspace.getSubdomainPermissions.queryOptions(),
    staleTime: STALE_TIME,
  });
  const { data: credentialsData } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );
  const credentialGroups = useMemo(
    () =>
      Object.values(
        ((credentialsData?.credentials ?? []) as WorkspaceCredential[])
          .filter((credential) => credential.isActive)
          .reduce<
            Record<
              string,
              {
                key: string;
                name: string;
                credentials: WorkspaceCredential[];
              }
            >
          >((groups, credential) => {
            const key = credential.logicalProviderKey;
            groups[key] ??= { key, name: credential.providerDisplayName, credentials: [] };
            groups[key].credentials.push(credential);
            return groups;
          }, {}),
      ),
    [credentialsData?.credentials],
  );
  const [credentialSelections, setCredentialSelections] = useState<Record<string, string | null>>(
    {},
  );

  useEffect(() => {
    setCredentialSelections((current) => {
      const next = { ...current };
      for (const group of credentialGroups) {
        if (!(group.key in next)) {
          next[group.key] =
            group.credentials.find((credential) => credential.isDefault)?.id ??
            group.credentials[0]?.id ??
            null;
        }
      }
      return next;
    });
  }, [credentialGroups]);

  // The API selects dashboard credentials by provider + label.
  const selectedModelCredentials = credentialGroups.flatMap((group) =>
    group.credentials
      .filter((credential) => credential.id === credentialSelections[group.key])
      .map(
        (credential) =>
          [
            credential.logicalProviderKey,
            { source: "saved" as const, label: credential.label },
          ] as const,
      ),
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
  const hasNoProviders = !isLoadingCloudProviders && cloudProviders.length === 0;

  const { data: session } = authClient.useSession();
  const { data: billingAccount } = useBillingAccount();
  const [alwaysOn, setAlwaysOn] = useState(false);
  const canKeepAlwaysOn = billingAccount?.entitlements.alwaysOn ?? !isBillingEnabled();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  const defaultGroupKey: CloudGroupKey | "" = useMemo(() => {
    if (defaultCloudProviderId) {
      if (awsProviders.some((p) => p.id === defaultCloudProviderId)) return "aws";
      if (nonAwsProviders.some((p) => p.id === defaultCloudProviderId)) {
        return defaultCloudProviderId;
      }
    }
    return hasAwsGroup ? "aws" : (nonAwsProviders[0]?.id ?? "");
  }, [defaultCloudProviderId, awsProviders, nonAwsProviders, hasAwsGroup]);

  const [userCloudGroupKey, setUserCloudGroupKey] = useState<CloudGroupKey | null>(null);
  const selectedCloudGroupKey = userCloudGroupKey ?? defaultGroupKey;
  const isAwsGroup = selectedCloudGroupKey === "aws";

  // If the saved default is a specific AWS region-provider, pin it so the right
  // region is pre-selected.
  useEffect(() => {
    if (
      defaultCloudProviderId &&
      userCloudProviderId === null &&
      awsProviders.some((p) => p.id === defaultCloudProviderId)
    ) {
      setUserCloudProviderId(defaultCloudProviderId);
    }
  }, [defaultCloudProviderId, userCloudProviderId, awsProviders]);

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
  const awsAccessProfiles = selectedCloudProvider?.awsAccessProfiles ?? [];
  const selectedAwsProfileId =
    awsProfileSelection?.providerId === selectedCloudProviderId &&
    awsAccessProfiles.some((profile) => profile.id === awsProfileSelection.id)
      ? awsProfileSelection.id
      : undefined;
  const availableMachineProfiles = selectedCloudProvider?.machineProfiles ?? [];
  const usableMachineProfiles = availableMachineProfiles.filter(
    (profile) => profile.available !== false,
  );
  const selectedMachineProfileId =
    (userMachineProfileId &&
    usableMachineProfiles.some((profile) => profile.id === userMachineProfileId)
      ? userMachineProfileId
      : undefined) ??
    usableMachineProfiles.find((profile) => profile.isDefault)?.id ??
    usableMachineProfiles[0]?.id;
  const selectedMachineProfile = availableMachineProfiles.find(
    (profile) => profile.id === selectedMachineProfileId,
  );

  // Persistence capability for the selected provider. Some providers (e.g.
  // Cloudflare sandboxes) cannot keep files between sessions at all.
  const persistenceSupported = selectedCloudProvider?.supportsPersistence !== false;
  const isAutoPersistent = persistenceSupported && !!selectedCloudProvider?.autoPersistent;
  // Storage persists whenever it can: always on providers that force it, and on the others
  // unless the plan does not include persistence.
  const canOptInPersistence = billingAccount?.entitlements.persistence ?? !isBillingEnabled();
  const effectivePersistent = persistenceSupported && (isAutoPersistent || canOptInPersistence);

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

  // Agent and Cloud fill the first row; the optional fields pair up after them, and an odd one
  // out takes the whole row.
  const halfCells = [
    shouldShowRegionSelector && "region",
    availableMachineProfiles.length > 1 && "machine",
    githubAvailability?.enabled && "github",
  ].filter(Boolean);
  const wideCell = halfCells.length % 2 ? halfCells.at(-1) : null;

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
      const fallbackComposite = fallback ? `${awsProviders[0].id}::${fallback.id}` : "";
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

  const selectedAgent = availableAgents.find((agent) => agent.id === selectedAgentTypeId);
  const supportsMcp = selectedAgent?.provisionerKey === "opencode";
  const selectedIntegrations =
    (googleCloudIntegrationId !== "none" ? 1 : 0) + (supportsMcp ? mcpConnectionIds.length : 0);

  const handleCloudGroupChange = (groupKey: CloudGroupKey) => {
    setUserCloudGroupKey(groupKey);
    setUserRegionId(null);
    setUserMachineProfileId(null);
    if (groupKey === "aws") {
      // Default to first AWS provider; region picker will refine selection.
      setUserCloudProviderId(awsProviders[0]?.id ?? null);
    } else {
      setUserCloudProviderId(groupKey);
    }
  };

  const handleRegionChange = (regionValue: string) => {
    setUserRegionId(regionValue);
    setUserMachineProfileId(null);
    if (isAwsGroup) {
      // AWS region values are "<providerId>::<regionId>" so we can route the
      // selection back to the right region-provider row.
      const [providerId] = regionValue.split("::");
      if (providerId) {
        setUserCloudProviderId(providerId);
      }
    }
  };

  // Mutation
  const createAttempt = useRef<{ startedAt: number; properties: WorkspaceProperties } | null>(null);
  const { mutateAsync: createWorkspace, isPending: isSubmitting } = useMutation(
    trpc.workspace.createWorkspace.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
        if (createAttempt.current) {
          track("workspace_create_succeeded", {
            ...createAttempt.current.properties,
            duration_ms: Math.round(performance.now() - createAttempt.current.startedAt),
          });
        }
        onSuccess({
          type: "workspace",
          workspaceId: data.workspace.id,
          userId: data.workspace.userId,
          provider: createAttempt.current?.properties.provider ?? "unknown",
          agent: createAttempt.current?.properties.agent ?? "unknown",
        });
      },
      onError: (error) => {
        if (createAttempt.current) {
          track("workspace_create_failed", {
            ...createAttempt.current.properties,
            duration_ms: Math.round(performance.now() - createAttempt.current.startedAt),
            error_code: analyticsErrorCode(error),
          });
        }
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
    if (isSubmitting || createAttempt.current) return;
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

    const workspaceConnections = [
      githubAvailability?.enabled && selectedGitIntegrationId.startsWith("app:")
        ? selectedGitIntegrationId.slice(4)
        : null,
      githubAvailability?.enabled && selectedGitIntegrationId === "global-pat"
        ? "github:shared"
        : null,
      isGoogleCloudAvailable && googleCloudIntegrationId !== "none"
        ? googleCloudIntegrationId
        : null,
      ...(supportsMcp
        ? mcpConnectionIds.filter((id) =>
            mcpConnections.some(
              (connection) => connection.id === id && connection.status === "connected",
            ),
          )
        : []),
    ].filter((id): id is string => Boolean(id));
    const properties: WorkspaceProperties = {
      provider: selectedCloudProvider?.providerKey ?? "unknown",
      agent: selectedAgent?.provisionerKey ?? "unknown",
      persistent: effectivePersistent,
      always_on: canKeepAlwaysOn && alwaysOn,
      model_provider_count: selectedModelCredentials.length,
      integration_count: workspaceConnections.length,
    };
    createAttempt.current = { startedAt: performance.now(), properties };
    track("workspace_create_started", properties);
    try {
      await createWorkspace({
        name: normalizedRepoUrl.split("/").pop() || "new-workspace",
        repo: normalizedRepoUrl,
        branch: trimmedBranch || undefined,
        agentTypeId: selectedAgentTypeId,
        cloudProviderId: resolvedCloudProviderId,
        regionId: resolvedRegionId,
        machineProfileId: selectedMachineProfileId,
        awsAccessProfileId: isAwsGroup ? selectedAwsProfileId : undefined,
        connections: workspaceConnections,
        persistent: effectivePersistent,
        alwaysOn: canKeepAlwaysOn && alwaysOn,
        subdomain: subdomain || undefined,
        workspaceProfile,
        models: { inherit: "none", providers: Object.fromEntries(selectedModelCredentials) },
      });
    } catch {
      // onError reports the failure to the user and records its safe category.
    } finally {
      createAttempt.current = null;
    }
  };

  const integrations = installationsData?.installations;
  const hasIntegrations = !!(integrations?.length || githubAvailability?.mode === "pat");
  const selectedGitIntegrationId =
    userGitIntegrationId ??
    (integrations?.[0] ? `app:${integrations[0].git_integration.id}` : "none");

  const selectedGitIntegration = useMemo(() => {
    if (!integrations || !selectedGitIntegrationId.startsWith("app:")) {
      return null;
    }
    const match = integrations.find(
      (installation) => installation.git_integration.id === selectedGitIntegrationId.slice(4),
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={selectedAgentTypeId} onValueChange={setUserAgentTypeId}>
              <SelectTrigger className="h-9 w-full">
                {selectedAgent ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <Image
                      src={getIcon(selectedAgent.name) || "/placeholder.svg"}
                      alt={selectedAgent.name}
                      width={16}
                      height={16}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="truncate">{selectedAgent.name}</span>
                  </div>
                ) : (
                  <SelectValue placeholder="Select agent" />
                )}
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
                        <div className="flex items-center gap-2">
                          <Image
                            src={getIcon(agent.name) || "/placeholder.svg"}
                            alt={agent.name}
                            width={16}
                            height={16}
                            className="h-4 w-4 shrink-0"
                          />
                          <span>{agent.name}</span>
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
            <Label className="text-xs font-medium text-muted-foreground">Cloud</Label>
            <div className="flex gap-2 min-w-0">
              <Select
                value={selectedCloudGroupKey}
                onValueChange={handleCloudGroupChange}
                disabled={hasNoProviders}
              >
                <SelectTrigger className="h-9 w-full min-w-0">
                  <SelectValue placeholder={hasNoProviders ? "No providers" : "Select cloud"} />
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
                    {nonAwsProviders.length > 0
                      ? nonAwsProviders.map((cloud) => (
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
                              {cloud.location && (
                                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                                  {cloud.location}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))
                      : null}
                  </SelectContent>
                )}
              </Select>

              {hasNoProviders && isAdmin ? (
                <Link
                  href={"/admin/providers" as Route}
                  className="inline-flex items-center gap-1 self-center text-[11px] font-medium text-primary hover:underline"
                >
                  Add a provider
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          </div>

          {shouldShowRegionSelector ? (
            <div
              className={cn("grid content-start gap-1.5", wideCell === "region" && "sm:col-span-2")}
            >
              <Label className="text-xs font-medium text-muted-foreground">Region</Label>
              <Select
                value={selectedRegion}
                onValueChange={handleRegionChange}
                disabled={availableRegions.length === 0}
              >
                <SelectTrigger className="h-9 w-full min-w-0 [&>span]:truncate">
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
            </div>
          ) : null}

          {availableMachineProfiles.length > 1 && (
            <div
              className={cn(
                "grid content-start gap-1.5",
                wideCell === "machine" && "sm:col-span-2",
              )}
            >
              <Label className="text-xs font-medium text-muted-foreground">Machine</Label>
              <Select value={selectedMachineProfileId} onValueChange={setUserMachineProfileId}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Select machine size" />
                </SelectTrigger>
                <SelectContent>
                  {/* Sizes the plan allows come first; locked ones follow, in their usual order. */}
                  {availableMachineProfiles
                    .toSorted(
                      (a, b) => Number(a.available === false) - Number(b.available === false),
                    )
                    .map((profile) => (
                      <SelectItem
                        key={profile.id}
                        value={profile.id}
                        disabled={profile.available === false}
                      >
                        {/* Fixed columns so name, size and price line up across rows. */}
                        <span className="grid grid-cols-[4.25rem_6rem_3.75rem] items-baseline gap-x-2">
                          <span className="truncate">{profile.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatMachineSize(profile) ?? profile.key}
                          </span>
                          <span className="text-right font-mono text-[10px] text-muted-foreground">
                            {profile.priceMicrosPerHour != null
                              ? formatHourlyPrice(profile.priceMicrosPerHour)
                              : ""}
                          </span>
                        </span>
                        {profile.available === false && (
                          <span className="ml-3 text-[10px] text-primary">Paid plans</span>
                        )}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedMachineProfile?.description && (
                <p className="text-[11px] text-muted-foreground/70">
                  {selectedMachineProfile.description}
                </p>
              )}
              {isBillingEnabled() &&
                usableMachineProfiles.length < availableMachineProfiles.length && (
                  <Link
                    href={"/pricing" as Route}
                    className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    Upgrade for larger machines
                  </Link>
                )}
            </div>
          )}

          {canKeepAlwaysOn ? (
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <Checkbox
                className="mt-0.5"
                checked={alwaysOn}
                onCheckedChange={(checked) => setAlwaysOn(checked === true)}
              />
              <span>
                <span className="font-medium text-foreground/90">Keep running when idle</span>
                <span className="block text-muted-foreground">
                  {isBillingEnabled()
                    ? "Always-on workspaces aren't paused for inactivity, so compute keeps accruing while idle."
                    : "Always-on workspaces aren't paused for inactivity."}
                </span>
              </span>
            </label>
          ) : null}

          {/* ── 3. GitHub Connection ── */}
          {githubAvailability?.enabled ? (
            <div
              className={cn("grid content-start gap-1.5", wideCell === "github" && "sm:col-span-2")}
            >
              <Label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                GitHub repository access
                <Link href="/dashboard/integrations" className="text-primary hover:text-fg-2">
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Label>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedGitIntegrationId}
                  onValueChange={setuserGitIntegrationId}
                  disabled={!hasIntegrations}
                >
                  <SelectTrigger className="h-9 min-w-0 flex-1">
                    <SelectValue
                      placeholder={hasIntegrations ? "Select account" : "No connections"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (public repos only)</SelectItem>
                    {integrations?.map((installation) => (
                      <SelectItem
                        key={installation.git_integration.id}
                        value={`app:${installation.git_integration.id}`}
                      >
                        <div className="flex items-center">
                          <Image
                            src="/github.svg"
                            alt="GitHub"
                            width={16}
                            height={16}
                            className="mr-2 h-4 w-4"
                          />
                          {installation.git_integration.providerAccountLogin} · GitHub App
                        </div>
                      </SelectItem>
                    ))}
                    {githubAvailability.mode === "pat" ? (
                      <SelectItem value="global-pat">
                        Shared GitHub PAT (@{githubAvailability.accountLogin})
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                {/* Help sits beside the picker so it never covers the controls above */}
                <HelpHint label="What does a GitHub connection do?">
                  Connect a GitHub account to enable commit, push, fork and private repo access.
                </HelpHint>
              </div>
            </div>
          ) : null}

          {isAwsGroup && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label
                htmlFor="aws-access-profile"
                className="text-xs font-medium text-muted-foreground"
              >
                AWS access
              </Label>
              <Select
                value={selectedAwsProfileId ?? "default"}
                onValueChange={(id) =>
                  setAwsProfileSelection(
                    id === "default" ? null : { providerId: selectedCloudProviderId, id },
                  )
                }
              >
                <SelectTrigger id="aws-access-profile" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Provider default role</SelectItem>
                  {awsAccessProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {awsAccessProfiles.find((profile) => profile.id === selectedAwsProfileId)
                  ?.description ||
                  "Use an administrator-added task role with temporary AWS credentials. All listed roles are available to all users."}{" "}
                The selected role stays with this workspace after pause/resume.
              </p>
            </div>
          )}
        </div>

        {/* ── 3b. Model providers ── */}
        {credentialGroups.length > 0 ? (
          <ModelProviderPicker
            groups={credentialGroups}
            selections={credentialSelections}
            onChange={(key, credentialId) =>
              setCredentialSelections((current) => ({ ...current, [key]: credentialId }))
            }
          />
        ) : credentialsData ? (
          <ModelProviderEmpty />
        ) : null}

        {/* ── 4b. Optional integrations, folded away until someone wants one ── */}
        {isGoogleCloudAvailable || mcpConnections.length > 0 || integrationSetups.length > 0 ? (
          <div className="min-w-0 rounded-xl border border-dashed border-line">
            <button
              type="button"
              aria-expanded={showIntegrations}
              onClick={() => setShowIntegrations((value) => !value)}
              className="flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-fill"
            >
              <Plus className="size-3.5 shrink-0 text-fg-4" />
              <span className="text-xs text-fg-2">Add integrations</span>
              <span className="truncate text-xs text-fg-4">{integrationTypes.join(", ")}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {selectedIntegrations > 0 ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                    {selectedIntegrations} selected
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    "size-3.5 text-fg-4 transition-transform",
                    showIntegrations && "rotate-180",
                  )}
                />
              </span>
            </button>
            {showIntegrations ? (
              <div className="space-y-4 border-t border-line px-3.5 py-3.5">
                {isGoogleCloudAvailable ? (
                  <div className="grid gap-1.5">
                    <Label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      Google Cloud Identity
                      <Link href="/dashboard/integrations" className="text-primary hover:text-fg-2">
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={googleCloudIntegrationId}
                        onValueChange={setGoogleCloudIntegrationId}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select service account" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {googleCloudIntegrations.map((integration) => (
                            <SelectItem key={integration.id} value={integration.id}>
                              {integration.name} · {integration.projectId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <HelpHint label="How is Google Cloud authenticated?">
                        GitTerm exchanges a five-minute workspace identity through Google Workload
                        Identity Federation. No service-account JSON key is stored.
                      </HelpHint>
                    </div>
                  </div>
                ) : null}

                {mcpConnections.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs font-medium text-muted-foreground">
                        MCP servers and Executor
                      </Label>
                      <Link
                        href={"/dashboard/integrations" as Route}
                        className="text-xs text-muted-foreground underline underline-offset-2"
                      >
                        Manage connections
                      </Link>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {supportsMcp
                        ? "Choose servers for this workspace. OpenCode connects directly; their credentials will be available to its agent."
                        : "GitTerm MCP connections require an OpenCode workspace. T3Code is not supported yet."}
                    </p>
                    {connectionsError ? (
                      <p role="alert" className="text-xs text-red-400">
                        Couldn't load connections. You can create a workspace without MCP tools.
                      </p>
                    ) : null}
                    {mcpConnections.map((connection) => (
                      <label key={connection.id} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          disabled={
                            !supportsMcp ||
                            connection.status !== "connected" ||
                            (mcpConnectionIds.length >= 30 &&
                              !mcpConnectionIds.includes(connection.id))
                          }
                          checked={
                            supportsMcp &&
                            connection.status === "connected" &&
                            mcpConnectionIds.includes(connection.id)
                          }
                          onCheckedChange={(checked) =>
                            setMcpConnectionIds((ids) =>
                              checked === true
                                ? [...new Set([...ids, connection.id])]
                                : ids.filter((id) => id !== connection.id),
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {connection.status === "connected"
                            ? connection.integration === "executor"
                              ? "Executor"
                              : "MCP"
                            : "Needs attention"}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}

                {integrationSetups.length > 0 ? (
                  <div className="space-y-2">
                    {isGoogleCloudAvailable || mcpConnections.length > 0 ? (
                      <Label className="text-xs font-medium text-muted-foreground">Add more</Label>
                    ) : null}
                    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                      {integrationSetups.map((setup) => (
                        <Link
                          key={setup.key}
                          href={"/dashboard/integrations" as Route}
                          className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-fill"
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center">
                            {setup.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs text-fg-2">{setup.name}</span>
                            <span className="block truncate text-xs text-fg-4">
                              {setup.description}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                            Set up
                            <ArrowUpRight className="size-3" />
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !isValid} className="gap-2">
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

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { queryClient, trpc } from "@/utils/trpc";
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
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getAgentConnectCommand } from "@/lib/utils";
import { useWorkspaceStatusWatcher } from "@/components/workspace-status-watcher";
import {
  WorkspaceTypeSelector,
  LocalTunnelForm,
  CloudWorkspaceForm,
  CliCommandDisplay,
  RalphWiggumForm,
  MODEL_PROVIDERS,
  getModelsForProvider,
  type WorkspaceType,
  type AgentType,
  type CloudProvider,
  type Region,
  type Repository,
  type RepoFile,
  type RunMode,
} from "./create-instance";

export function CreateInstanceDialog() {
  const [open, setOpen] = useState(false);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>("cloud");
  const [repoUrl, setRepoUrl] = useState("");
  const [localSubdomain, setLocalSubdomain] = useState<string>("");
  const [cloudSubdomain, setCloudSubdomain] = useState<string>("");
  const [localName, setLocalName] = useState("");
  const [cliCommand, setCliCommand] = useState<string | null>(null);
  const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>("");
  const [selectedCloudProviderId, setSelectedCloudProviderId] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [selectedGitInstallationId, setSelectedGitInstallationId] = useState<string | undefined>("none");
  const [selectedPersistent, setSelectedPersistent] = useState<boolean>(true);
  const { watchWorkspaceStatus } = useWorkspaceStatusWatcher();

  // Ralph Wiggum specific state
  const [ralphInstallationId, setRalphInstallationId] = useState<string>("");
  const [ralphRepository, setRalphRepository] = useState<Repository | null>(null);
  const [ralphBranch, setRalphBranch] = useState<string>("");
  const [ralphPlanFile, setRalphPlanFile] = useState<RepoFile | null>(null);
  const [ralphDocumentationFile, setRalphDocumentationFile] = useState<RepoFile | null>(null);
  const [ralphRunMode, setRalphRunMode] = useState<RunMode>("automatic");
  const [ralphIterations, setRalphIterations] = useState<number>(5);
  const [ralphProvider, setRalphProvider] = useState<string>(MODEL_PROVIDERS[0]?.id ?? "");
  const [ralphModel, setRalphModel] = useState<string>(MODEL_PROVIDERS[0]?.models[0]?.id ?? "");

  const { data: agentTypesData } = useQuery(trpc.workspace.listAgentTypes.queryOptions());
  const { data: cloudProvidersData } = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());
  const { data: subdomainPermissions } = useQuery(trpc.workspace.getSubdomainPermissions.queryOptions());

  const localProvider = useMemo(() => {
    return cloudProvidersData?.cloudProviders?.find(
      (cloud) => cloud.name.toLowerCase() === "local"
    );
  }, [cloudProvidersData]);

  const cloudProviders = useMemo((): CloudProvider[] => {
    return (cloudProvidersData?.cloudProviders?.filter(
      (cloud) => cloud.name.toLowerCase() !== "local"
    ) ?? []) as CloudProvider[];
  }, [cloudProvidersData]);

  const availableRegions = useMemo((): Region[] => {
    if (!selectedCloudProviderId || !cloudProvidersData?.cloudProviders) {
      return [];
    }
    const selectedCloud = cloudProvidersData.cloudProviders.find(
      (cloud) => cloud.id === selectedCloudProviderId
    );
    return (selectedCloud?.regions ?? []) as Region[];
  }, [selectedCloudProviderId, cloudProvidersData]);

  // Get filtered agent types based on workspace type
  const filteredAgentTypes = useMemo((): AgentType[] => {
    if (!agentTypesData?.agentTypes) return [];
    if (workspaceType === "local") {
      return agentTypesData.agentTypes.filter((agent) => agent.serverOnly) as AgentType[];
    }
    return agentTypesData.agentTypes as AgentType[];
  }, [agentTypesData, workspaceType]);

  // Auto-select first agent when workspace type changes or on initial load
  useEffect(() => {
    if (filteredAgentTypes.length > 0 && workspaceType !== "ralph-wiggum") {
      const currentAgentValid = filteredAgentTypes.some(
        (agent) => agent.id === selectedAgentTypeId
      );
      if (!currentAgentValid) {
        setSelectedAgentTypeId(filteredAgentTypes[0].id);
      }
    }
  }, [filteredAgentTypes, selectedAgentTypeId, workspaceType]);

  // Auto-select first installation for Ralph Wiggum
  useEffect(() => {
    if (
      workspaceType === "ralph-wiggum" &&
      installationsData?.installations &&
      installationsData.installations.length > 0 &&
      !ralphInstallationId
    ) {
      setRalphInstallationId(installationsData.installations[0].git_integration.id);
    }
  }, [workspaceType, installationsData, ralphInstallationId]);

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
        if (!selectedRegion || !availableRegions.some((reg) => reg.id === selectedRegion)) {
          setSelectedRegion(availableRegions[0].id);
        }
      } else {
        setSelectedRegion("");
      }
    }
  }, [workspaceType, availableRegions, selectedRegion]);

  useEffect(() => {
    if (!open) {
      setCliCommand(null);
      setCloudSubdomain("");
      setLocalSubdomain("");
      setSelectedRegion("");
      // Reset Ralph Wiggum state
      setRalphRepository(null);
      setRalphBranch("");
      setRalphPlanFile(null);
      setRalphDocumentationFile(null);
      setRalphRunMode("automatic");
      setRalphIterations(5);
      setRalphProvider(MODEL_PROVIDERS[0]?.id ?? "");
      setRalphModel(MODEL_PROVIDERS[0]?.models[0]?.id ?? "");
    }
  }, [open]);

  const createServiceMutation = useMutation(
    trpc.workspace.createWorkspace.mutationOptions({
      onSuccess: (data) => {
        if (data.command) {
          toast.success("Local tunnel created successfully");
          setCliCommand(getAgentConnectCommand(data.workspace.id));
        } else {
          toast.success("Workspace is provisioning");
          watchWorkspaceStatus({ workspaceId: data.workspace.id, userId: data.workspace.userId });
        }
        setOpen(false);
        queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to create workspace: ${error.message}`);
      },
    })
  );

  const createAgentLoopMutation = useMutation(
    trpc.agentLoop.createLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Agent loop created! Go to Agent Loops to start your first run.");
        queryClient.invalidateQueries(trpc.agentLoop.listLoops.queryOptions());
        setOpen(false);
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to create agent loop: ${error.message}`);
      },
    })
  );

  // Memoized callbacks for Ralph Wiggum form to prevent unnecessary rerenders
  const handleRalphRepositoryChange = useCallback((repo: Repository | null) => {
    setRalphRepository(repo);
  }, []);

  const handleRalphBranchChange = useCallback((branch: string) => {
    setRalphBranch(branch);
  }, []);

  const handleRalphPlanFileChange = useCallback((file: RepoFile | null) => {
    setRalphPlanFile(file);
  }, []);

  const handleRalphDocumentationFileChange = useCallback((file: RepoFile | null) => {
    setRalphDocumentationFile(file);
  }, []);

  const handleSubmit = async () => {
    if (workspaceType === "local") {
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

    if (workspaceType === "ralph-wiggum") {
      if (!ralphInstallationId) {
        toast.error("Please select a GitHub account.");
        return;
      }
      if (!ralphRepository) {
        toast.error("Please select a repository.");
        return;
      }
      if (!ralphBranch) {
        toast.error("Please select a branch.");
        return;
      }
      if (!ralphPlanFile) {
        toast.error("Please select a plan file.");
        return;
      }
      if (!ralphProvider) {
        toast.error("Please select an AI provider.");
        return;
      }
      if (!ralphModel) {
        toast.error("Please select a model.");
        return;
      }

      // Get the first cloud provider as sandbox provider (Cloudflare sandbox is used internally)
      const sandboxProvider = cloudProviders[0];
      if (!sandboxProvider) {
        toast.error("No sandbox provider available. Please try again later.");
        return;
      }

      const fullModelId = `${ralphProvider}/${ralphModel}`;
      
      // Create the loop only - user will start runs from the Agent Loops dashboard
      await createAgentLoopMutation.mutateAsync({
        gitIntegrationId: ralphInstallationId,
        sandboxProviderId: sandboxProvider.id,
        repositoryOwner: ralphRepository.owner,
        repositoryName: ralphRepository.name,
        branch: ralphBranch,
        planFilePath: ralphPlanFile.path,
        progressFilePath: ralphDocumentationFile?.path,
        modelProvider: ralphProvider,
        model: fullModelId,
        automationEnabled: ralphRunMode === "automatic",
        maxRuns: ralphIterations,
      });

      return;
    }

    // Cloud workspace
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
      subdomain: cloudSubdomain || undefined,
    });
  };

  const getDialogDescription = () => {
    switch (workspaceType) {
      case "cloud":
        return "Deploy a new development workspace from a GitHub repository.";
      case "local":
        return "Create a local tunnel to expose your local development server.";
      case "ralph-wiggum":
        return "Create an autonomous agent that executes tasks from your plan file.";
      default:
        return "";
    }
  };

  const getSubmitButtonText = () => {
    if (workspaceType === "ralph-wiggum") {
      if (createAgentLoopMutation.isPending) return "Creating loop...";
      return "Create Ralph Wiggum";
    }
    if (createServiceMutation.isPending) {
      return "Creating...";
    }
    return "Create Instance";
  };

  const isSubmitting = useMemo(() => {
    return createServiceMutation.isPending || createAgentLoopMutation.isPending;
  }, [
    createServiceMutation.isPending,
    createAgentLoopMutation.isPending,
  ]);

  // Validation for each form type
  const isFormValid = useMemo(() => {
    switch (workspaceType) {
      case "local":
        return !!(selectedAgentTypeId && localProvider && selectedRegion);
      case "cloud":
        return !!(repoUrl && selectedAgentTypeId && selectedCloudProviderId && selectedRegion);
      case "ralph-wiggum":
        const hasRequiredFields = !!(
          ralphInstallationId &&
          ralphRepository &&
          ralphBranch &&
          ralphPlanFile &&
          ralphProvider &&
          ralphModel
        );
        const hasValidIterations = ralphRunMode === "manual" || (ralphIterations >= 1 && ralphIterations <= 100);
        return hasRequiredFields && hasValidIterations;
      default:
        return false;
    }
  }, [
    workspaceType,
    selectedAgentTypeId,
    localProvider,
    selectedRegion,
    repoUrl,
    selectedCloudProviderId,
    ralphInstallationId,
    ralphRepository,
    ralphBranch,
    ralphPlanFile,
    ralphRunMode,
    ralphIterations,
    ralphProvider,
    ralphModel,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New Instance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] border-border/50 bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Create New Instance</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>

        {cliCommand ? (
          <CliCommandDisplay
            command={cliCommand}
            onDone={() => {
              setOpen(false);
              setCliCommand(null);
            }}
          />
        ) : (
          <>
            <div className="grid gap-5 py-4">
              <WorkspaceTypeSelector value={workspaceType} onChange={setWorkspaceType} />

              {workspaceType === "local" && (
                <LocalTunnelForm
                  subdomain={localSubdomain}
                  onSubdomainChange={setLocalSubdomain}
                  name={localName}
                  onNameChange={setLocalName}
                  selectedAgentTypeId={selectedAgentTypeId}
                  onAgentTypeChange={setSelectedAgentTypeId}
                  agentTypes={filteredAgentTypes}
                  subdomainPermissions={subdomainPermissions}
                />
              )}

              {workspaceType === "cloud" && (
                <CloudWorkspaceForm
                  repoUrl={repoUrl}
                  onRepoUrlChange={setRepoUrl}
                  subdomain={cloudSubdomain}
                  onSubdomainChange={setCloudSubdomain}
                  selectedAgentTypeId={selectedAgentTypeId}
                  onAgentTypeChange={setSelectedAgentTypeId}
                  agentTypes={filteredAgentTypes}
                  selectedCloudProviderId={selectedCloudProviderId}
                  onCloudProviderChange={setSelectedCloudProviderId}
                  cloudProviders={cloudProviders}
                  selectedRegion={selectedRegion}
                  onRegionChange={setSelectedRegion}
                  availableRegions={availableRegions}
                  selectedGitInstallationId={selectedGitInstallationId}
                  onGitInstallationChange={setSelectedGitInstallationId}
                  installations={installationsData?.installations}
                  persistent={selectedPersistent}
                  onPersistentChange={setSelectedPersistent}
                  subdomainPermissions={subdomainPermissions}
                />
              )}

              {workspaceType === "ralph-wiggum" && (
                <RalphWiggumForm
                  installations={installationsData?.installations}
                  selectedInstallationId={ralphInstallationId}
                  onInstallationChange={setRalphInstallationId}
                  selectedRepository={ralphRepository}
                  onRepositoryChange={handleRalphRepositoryChange}
                  selectedBranch={ralphBranch}
                  onBranchChange={handleRalphBranchChange}
                  planFile={ralphPlanFile}
                  onPlanFileChange={handleRalphPlanFileChange}
                  documentationFile={ralphDocumentationFile}
                  onDocumentationFileChange={handleRalphDocumentationFileChange}
                  runMode={ralphRunMode}
                  onRunModeChange={setRalphRunMode}
                  iterations={ralphIterations}
                  onIterationsChange={setRalphIterations}
                  selectedProvider={ralphProvider}
                  onProviderChange={setRalphProvider}
                  selectedModel={ralphModel}
                  onModelChange={setRalphModel}
                />
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
                className="border-border/50 hover:bg-secondary/50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !isFormValid}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {getSubmitButtonText()}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {getSubmitButtonText()}
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

"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { queryClient, trpc } from "@/utils/trpc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, GitBranch, AlertCircle, Loader2, Plus } from "lucide-react";
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
import { RepoSearch } from "./repo-search";
import { RepoFileSearch } from "./repo-file-search";
import {
  type Repository,
  type RepoFile,
  type RunMode,
  type Branch,
  type CreateInstanceResult,
} from "./types";

interface CreateAutoAgentProps {
  onSuccess: (result: CreateInstanceResult) => void;
  onCancel: () => void;
}

interface Model {
  id: string;
  name: string;
  displayName: string;
  modelId: string; // External model ID (e.g., "claude-opus-4")
  isFree: boolean;
  isRecommended: boolean;
  provider: Provider;
}

interface Provider {
  id: string;
  name: string;
  displayName: string;
  isRecommended?: boolean;
}

// Helper to get provider logo path
const getProviderLogo = (providerName: string): string => {
  return `/${providerName}.svg`;
};

export function CreateAutoAgent({ onSuccess, onCancel }: CreateAutoAgentProps) {
  // Fetch providers and models from the database
  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    trpc.modelCredentials.listProviders.queryOptions()
  );
  const { data: modelsData, isLoading: isLoadingModels } = useQuery(
    trpc.modelCredentials.listModels.queryOptions()
  );
  const { data: credentialsData } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions()
  );

  const providers = (providersData?.providers ?? []) as Provider[];
  const allModels = (modelsData?.models ?? []) as Model[];

  // Form state (null = use default)
  const [userInstallationId, setUserInstallationId] = useState<string | null>(null);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [branch, setBranch] = useState("");
  const [planFile, setPlanFile] = useState<RepoFile | null>(null);
  const [documentationFile, setDocumentationFile] = useState<RepoFile | null>(null);
  const [runMode, setRunMode] = useState<RunMode>("automatic");
  const [iterations, setIterations] = useState(5);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  // Get the best default provider (prefer recommended, specifically Zen first)
  const getDefaultProvider = useCallback(() => {
    if (providers.length === 0) return undefined;
    const zenProvider = providers.find((p) => p.name === "opencode-zen");
    if (zenProvider) return zenProvider;
    const recommended = providers.find((p) => p.isRecommended);
    if (recommended) return recommended;
    return providers[0];
  }, [providers]);

  // Get the best default model for a provider (prefer recommended)
  const getDefaultModelForProvider = useCallback((providerId: string) => {
    const providerModels = allModels.filter((m) => m.provider.id === providerId);
    if (providerModels.length === 0) return undefined;
    const recommended = providerModels.find((m) => m.isRecommended);
    if (recommended) return recommended;
    return providerModels[0];
  }, [allModels]);

  // Set default provider/model when data loads
  useEffect(() => {
    if (providers.length > 0 && !selectedProviderId) {
      const defaultProvider = getDefaultProvider();
      if (defaultProvider) {
        setSelectedProviderId(defaultProvider.id);
      }
    }
  }, [providers, selectedProviderId, getDefaultProvider]);

  useEffect(() => {
    if (selectedProviderId && allModels.length > 0 && !selectedModelId) {
      const defaultModel = getDefaultModelForProvider(selectedProviderId);
      if (defaultModel) {
        setSelectedModelId(defaultModel.id);
      }
    }
  }, [selectedProviderId, allModels, selectedModelId, getDefaultModelForProvider]);

  // Data fetching
  const { data: installationsData } = useQuery(trpc.workspace.listUserInstallations.queryOptions());
  const { data: cloudProvidersData } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true, sandboxOnly: true }),
  );

  const installations = installationsData?.installations;
  const hasInstallations = installations && installations.length > 0;

  // Derived: effective installation
  const selectedInstallationId = userInstallationId ?? installations?.[0]?.git_integration.id ?? "";

  const currentInstallation = useMemo(() => {
    if (!selectedInstallationId || !installations) return null;
    return installations.find((inst) => inst.git_integration.id === selectedInstallationId);
  }, [selectedInstallationId, installations]);

  const providerInstallationId = currentInstallation?.git_integration.providerInstallationId;

  // Fetch repos and branches
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    ...trpc.github.listAccessibleRepos.queryOptions({
      installationId: providerInstallationId || "",
    }),
    enabled: !!providerInstallationId,
  });

  const { data: branchesData, isLoading: isLoadingBranches } = useQuery({
    ...trpc.github.listBranches.queryOptions({
      installationId: providerInstallationId || "",
      owner: repository?.owner || "",
      repo: repository?.name || "",
    }),
    enabled: !!providerInstallationId && !!repository,
  });

  // Computed values
  const availableModels = useMemo(
    () => allModels.filter((m) => m.provider.id === selectedProviderId),
    [allModels, selectedProviderId]
  );

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const selectedModel = allModels.find((m) => m.id === selectedModelId);
  
  // Find credential for selected provider
  const credentialForProvider = useMemo(() => {
    if (!selectedProviderId || !credentialsData?.credentials) return null;
    return credentialsData.credentials.find((c) => c.providerId === selectedProviderId) ?? null;
  }, [selectedProviderId, credentialsData?.credentials]);

  // Handlers with cascading resets
  const handleInstallationChange = (id: string) => {
    setUserInstallationId(id);
    setRepository(null);
    setBranch("");
    setPlanFile(null);
    setDocumentationFile(null);
  };

  const handleRepositoryChange = (repo: Repository | null) => {
    setRepository(repo);
    setBranch(repo?.defaultBranch ?? "");
    setPlanFile(null);
    setDocumentationFile(null);
  };

  const handleBranchChange = (newBranch: string) => {
    setBranch(newBranch);
    setPlanFile(null);
    setDocumentationFile(null);
  };

  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    // Select best model for the new provider (prefer recommended)
    const defaultModel = getDefaultModelForProvider(providerId);
    if (defaultModel) {
      setSelectedModelId(defaultModel.id);
    } else {
      setSelectedModelId("");
    }
  };

  // Mutation
  const createAgentLoopMutation = useMutation(
    trpc.agentLoop.createLoop.mutationOptions({
      onSuccess: () => {
        toast.success("Ralph Agent created! Go to Agent Loops to start your first run.");
        queryClient.invalidateQueries(trpc.agentLoop.listLoops.queryOptions());
        onSuccess({ type: "agent-loop" });
      },
      onError: (error) => {
        console.error(error);
        toast.error(`Failed to create agent loop: ${error.message}`);
      },
    }),
  );

  // Validation
  const isValid = useMemo(() => {
    const hasRequiredFields = !!(
      selectedInstallationId &&
      repository &&
      branch &&
      planFile &&
      selectedProviderId &&
      selectedModelId
    );
    const hasValidIterations = runMode === "manual" || (iterations >= 1 && iterations <= 100);
    return hasRequiredFields && hasValidIterations;
  }, [selectedInstallationId, repository, branch, planFile, selectedProviderId, selectedModelId, runMode, iterations]);

  const isSubmitting = createAgentLoopMutation.isPending;

  const handleSubmit = async () => {
    if (!selectedInstallationId) {
      toast.error("Please select a GitHub account.");
      return;
    }
    if (!repository) {
      toast.error("Please select a repository.");
      return;
    }
    if (!branch) {
      toast.error("Please select a branch.");
      return;
    }
    if (!planFile) {
      toast.error("Please select a plan file.");
      return;
    }
    if (!selectedProviderId || !selectedModelId) {
      toast.error("Please select a provider and model.");
      return;
    }

    const sandboxProvider = cloudProvidersData?.cloudProviders[0];
    if (!sandboxProvider) {
      toast.error("No sandbox provider available. Please try again later.");
      return;
    }

    await createAgentLoopMutation.mutateAsync({
      gitIntegrationId: selectedInstallationId,
      sandboxProviderId: sandboxProvider.id,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      branch,
      planFilePath: planFile.path,
      progressFilePath: documentationFile?.path,
      modelProviderId: selectedProviderId,
      modelId: selectedModelId,
      credentialId: credentialForProvider?.id,
      automationEnabled: runMode === "automatic",
      maxRuns: iterations,
    });
  };

  // No installations - show connect prompt
  if (!hasInstallations) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg bg-secondary/30 border border-border/50 my-4">
          <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-center mb-2">GitHub Integration Required</p>
          <p className="text-xs text-muted-foreground text-center mb-4">
            Connect your GitHub account to use Ralph Agent.
          </p>
          <Link
            href="/dashboard/integrations"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium"
          >
            Connect GitHub
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-border/50 hover:bg-secondary/50"
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
        {/* GitHub Account */}
        <div className="grid gap-2">
          <Label className="text-sm font-medium flex items-center gap-1">
            GitHub Account
            <Link href="/dashboard/integrations" className="text-primary hover:text-primary/80">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Label>
          <Select value={selectedInstallationId} onValueChange={handleInstallationChange}>
            <SelectTrigger className="bg-secondary/30 border-border/50">
              <SelectValue placeholder="Select GitHub account" />
            </SelectTrigger>
            <SelectContent>
              {installations?.map((installation) => (
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

        {/* Repository */}
        <RepoSearch
          repos={reposData?.repos}
          isLoading={isLoadingRepos}
          value={repository}
          onChange={handleRepositoryChange}
          disabled={!providerInstallationId}
          placeholder="Search repositories..."
        />

        {/* Branch */}
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Branch</Label>
          <Select
            value={branch}
            onValueChange={handleBranchChange}
            disabled={!repository || isLoadingBranches}
          >
            <SelectTrigger className="bg-secondary/30 border-border/50">
              {isLoadingBranches ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading branches...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a branch" />
              )}
            </SelectTrigger>
            <SelectContent>
              {branchesData?.branches.map((b: Branch) => (
                <SelectItem key={b.name} value={b.name}>
                  <div className="flex items-center">
                    <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
                    {b.name}
                    {b.protected && (
                      <span className="ml-2 text-xs bg-yellow-500/20 text-yellow-600 px-1.5 py-0.5 rounded">
                        Protected
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* File selections - only show when repo & branch selected */}
        {providerInstallationId && repository && branch && (
          <>
            <RepoFileSearch
              installationId={providerInstallationId}
              owner={repository.owner}
              repo={repository.name}
              branch={branch}
              value={planFile}
              onChange={setPlanFile}
              label="Plan File"
              placeholder="Search for plan file..."
              description="Select the plan file that defines the tasks for the agent"
              required
            />
            <RepoFileSearch
              installationId={providerInstallationId}
              owner={repository.owner}
              repo={repository.name}
              branch={branch}
              value={documentationFile}
              onChange={setDocumentationFile}
              label="Documentation File"
              placeholder="Search for documentation file..."
              description="Optional documentation file to provide context to the agent"
            />
          </>
        )}

        {/* AI Provider & Model */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label className="text-sm font-medium">AI Provider</Label>
            <Select 
              value={selectedProviderId} 
              onValueChange={handleProviderChange}
              disabled={isLoadingProviders}
            >
              <SelectTrigger className="bg-secondary/30 border-border/50">
                {isLoadingProviders ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading...</span>
                  </div>
                ) : (
                  <SelectValue placeholder="Select provider" />
                )}
              </SelectTrigger>
              <SelectContent>
                {/* Sort providers: recommended first, then alphabetically */}
                {[...providers]
                  .sort((a, b) => {
                    if (a.isRecommended && !b.isRecommended) return -1;
                    if (!a.isRecommended && b.isRecommended) return 1;
                    return a.displayName.localeCompare(b.displayName);
                  })
                  .map((p) => (
                  <SelectItem 
                    key={p.id} 
                    value={p.id}
                    className=""
                  >
                    <div className="flex items-center gap-2">
                      <Image
                        src={getProviderLogo(p.name)}
                        alt={p.displayName}
                        width={16}
                        height={16}
                        className="h-4 w-4"
                      />
                      {p.displayName}
                      {p.isRecommended && (
                        <span className="text-xs text-muted-foreground">Recommended</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-medium">Model</Label>
            <Select
              value={selectedModelId}
              onValueChange={setSelectedModelId}
              disabled={!selectedProviderId || availableModels.length === 0 || isLoadingModels}
            >
              <SelectTrigger className="bg-secondary/30 border-border/50">
                {isLoadingModels ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading...</span>
                  </div>
                ) : (
                  <SelectValue placeholder="Select model" />
                )}
              </SelectTrigger>
              <SelectContent>
                {/* Sort models: recommended first, then alphabetically */}
                {[...availableModels]
                  .sort((a, b) => {
                    if (a.isRecommended && !b.isRecommended) return -1;
                    if (!a.isRecommended && b.isRecommended) return 1;
                    return a.displayName.localeCompare(b.displayName);
                  })
                  .map((m) => (
                  <SelectItem 
                    key={m.id} 
                    value={m.id}
                    className=""
                  >
                    <div className="flex items-center gap-2">
                      {m.displayName}
                      {m.isRecommended && (
                        <span className="text-xs text-muted-foreground">Recommended</span>
                      )}
                      {m.isFree && (
                        <span className="text-xs text-muted-foreground">Free</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          API keys are managed in Settings. You'll need to add one before starting runs.
        </p>

        {/* Run Mode */}
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Run Mode</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRunMode("automatic")}
              className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
                runMode === "automatic"
                  ? "border-accent bg-primary/10"
                  : "border-border/50 hover:border-border hover:bg-secondary"
              }`}
            >
              <p className="text-sm font-medium">Fully Automatic</p>
              <p className="text-xs text-muted-foreground mt-1">
                Agent runs iterations automatically
              </p>
            </button>
            <button
              type="button"
              onClick={() => setRunMode("manual")}
              className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
                runMode === "manual"
                  ? "border-accent bg-primary/10"
                  : "border-border/50 hover:border-border hover:bg-secondary"
              }`}
            >
              <p className="text-sm font-medium">Human in the Loop</p>
              <p className="text-xs text-muted-foreground mt-1">You manually trigger each run</p>
            </button>
          </div>
        </div>

        {/* Iterations (automatic mode only) */}
        {runMode === "automatic" && (
          <div className="grid gap-2">
            <Label htmlFor="iterations" className="text-sm font-medium">
              Number of Iterations
            </Label>
            <Input
              id="iterations"
              type="number"
              min={1}
              max={100}
              value={iterations}
              onChange={(e) => setIterations(Math.max(1, parseInt(e.target.value) || 1))}
              className="bg-secondary/30 border-border/50 focus:border-accent"
            />
            <p className="text-xs text-muted-foreground">
              How many times the agent will run automatically (1-100)
            </p>
          </div>
        )}
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
              Create Ralph Agent
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

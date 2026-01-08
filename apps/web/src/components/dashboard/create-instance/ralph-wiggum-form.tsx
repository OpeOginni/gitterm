"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { trpc } from "@/utils/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpRight, GitBranch, AlertCircle, Loader2 } from "lucide-react";
import { RepoFileSearch } from "./repo-file-search";
import { RepoSearch } from "./repo-search";
import type {
  GitInstallation,
  Repository,
  Branch,
  RepoFile,
  RunMode,
} from "./types";
import { ModelProviderSelect } from "./model-provider-select";

interface RalphWiggumFormProps {
  installations: GitInstallation[] | undefined;
  selectedInstallationId: string;
  onInstallationChange: (value: string) => void;
  selectedRepository: Repository | null;
  onRepositoryChange: (repo: Repository | null) => void;
  selectedBranch: string;
  onBranchChange: (value: string) => void;
  planFile: RepoFile | null;
  onPlanFileChange: (file: RepoFile | null) => void;
  documentationFile: RepoFile | null;
  onDocumentationFileChange: (file: RepoFile | null) => void;
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => void;
  iterations: number;
  onIterationsChange: (value: number) => void;
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export function RalphWiggumForm({
  installations,
  selectedInstallationId,
  onInstallationChange,
  selectedRepository,
  onRepositoryChange,
  selectedBranch,
  onBranchChange,
  planFile,
  onPlanFileChange,
  documentationFile,
  onDocumentationFileChange,
  runMode,
  onRunModeChange,
  iterations,
  onIterationsChange,
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
}: RalphWiggumFormProps) {
  const hasInstallations = installations && installations.length > 0;
  
  // Get the current installation's providerInstallationId
  const currentInstallation = useMemo(() => {
    if (!selectedInstallationId || !installations) return null;
    return installations.find(
      (inst) => inst.git_integration.id === selectedInstallationId
    );
  }, [selectedInstallationId, installations]);

  const providerInstallationId = currentInstallation?.git_integration.providerInstallationId;

  // Fetch repositories for the selected installation
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    ...trpc.github.listAccessibleRepos.queryOptions({
      installationId: providerInstallationId || "",
    }),
    enabled: !!providerInstallationId,
  });

  // Fetch branches for the selected repository
  const { data: branchesData, isLoading: isLoadingBranches } = useQuery({
    ...trpc.github.listBranches.queryOptions({
      installationId: providerInstallationId || "",
      owner: selectedRepository?.owner || "",
      repo: selectedRepository?.name || "",
    }),
    enabled: !!providerInstallationId && !!selectedRepository,
  });

  // Auto-select default branch when repository changes
  useEffect(() => {
    if (selectedRepository && !selectedBranch) {
      onBranchChange(selectedRepository.defaultBranch);
    }
  }, [selectedRepository, selectedBranch, onBranchChange]);

  // Clear dependent fields when installation changes
  useEffect(() => {
    onRepositoryChange(null);
    onBranchChange("");
    onPlanFileChange(null);
    onDocumentationFileChange(null);
  }, [selectedInstallationId]);

  // Clear file selections when repository or branch changes
  useEffect(() => {
    onPlanFileChange(null);
    onDocumentationFileChange(null);
  }, [selectedRepository, selectedBranch]);

  const handleRepositoryChange = (repo: Repository | null) => {
    onRepositoryChange(repo);
    onBranchChange(repo?.defaultBranch || "");
  };

  if (!hasInstallations) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg bg-secondary/30 border border-border/50">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-center mb-2">
          GitHub Integration Required
        </p>
        <p className="text-xs text-muted-foreground text-center mb-4">
          Connect your GitHub account to use Ralph Wiggum instances.
        </p>
        <Link
          href="/dashboard/integrations"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium"
        >
          Connect GitHub
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* GitHub Installation Selection */}
      <div className="grid gap-2">
        <Label className="text-sm font-medium flex items-center gap-1">
          GitHub Account
          <Link href="/dashboard/integrations" className="text-primary hover:text-primary/80">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Label>
        <Select value={selectedInstallationId} onValueChange={onInstallationChange}>
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

      {/* Repository Selection */}
      <RepoSearch
        repos={reposData?.repos}
        isLoading={isLoadingRepos}
        value={selectedRepository}
        onChange={handleRepositoryChange}
        disabled={!providerInstallationId}
        placeholder="Search repositories..."
      />

      {/* Branch Selection */}
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Branch</Label>
        <Select
          value={selectedBranch}
          onValueChange={onBranchChange}
          disabled={!selectedRepository || isLoadingBranches}
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
            {branchesData?.branches.map((branch: Branch) => (
              <SelectItem key={branch.name} value={branch.name}>
                <div className="flex items-center">
                  <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
                  {branch.name}
                  {branch.protected && (
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

      {/* Plan File Selection */}
      {providerInstallationId && selectedRepository && selectedBranch && (
        <>
          <RepoFileSearch
            installationId={providerInstallationId}
            owner={selectedRepository.owner}
            repo={selectedRepository.name}
            branch={selectedBranch}
            value={planFile}
            onChange={onPlanFileChange}
            label="Plan File"
            placeholder="Search for plan file..."
            description="Select the plan file that defines the tasks for the agent"
            required
          />

          <RepoFileSearch
            installationId={providerInstallationId}
            owner={selectedRepository.owner}
            repo={selectedRepository.name}
            branch={selectedBranch}
            value={documentationFile}
            onChange={onDocumentationFileChange}
            label="Documentation File"
            placeholder="Search for documentation file..."
            description="Optional documentation file to provide context to the agent"
          />
        </>
      )}

      {/* AI Model Selection */}
      <ModelProviderSelect
        selectedProvider={selectedProvider}
        onProviderChange={onProviderChange}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
      />

      {/* Run Mode Selection */}
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Run Mode</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onRunModeChange("automatic")}
            className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
              runMode === "automatic"
                ? "border-accent bg-primary/10"
                : "border-border/50 hover:border-border hover:bg-secondary"
            }`}
          >
            <p className={`text-sm font-medium ${runMode === "automatic" ? "text-foreground" : ""}`}>
              Fully Automatic
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Agent runs iterations automatically
            </p>
          </button>
          <button
            type="button"
            onClick={() => onRunModeChange("manual")}
            className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
              runMode === "manual"
                ? "border-accent bg-primary/10"
                : "border-border/50 hover:border-border hover:bg-secondary"
            }`}
          >
            <p className={`text-sm font-medium ${runMode === "manual" ? "text-foreground" : ""}`}>
              Human in the Loop
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              You manually trigger each run
            </p>
          </button>
        </div>
      </div>

      {/* Iterations (only for automatic mode) */}
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
            onChange={(e) => onIterationsChange(Math.max(1, parseInt(e.target.value) || 1))}
            className="bg-secondary/30 border-border/50 focus:border-accent"
          />
          <p className="text-xs text-muted-foreground">
            How many times the agent will run automatically (1-100)
          </p>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  GitBranch,
  Github,
  Loader2,
  Search,
} from "lucide-react";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Branch, ResolvedGitHubRepository } from "./types";
import { parseGitHubRepositoryInput } from "./github-repository-utils";

export interface GitIntegrationSelection {
  gitIntegrationId: string;
  providerInstallationId: string;
  label: string;
}

interface GitHubRepositoryBranchFieldProps {
  repoUrl: string;
  branch: string;
  onRepoUrlChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  integration: GitIntegrationSelection | null;
  disabled?: boolean;
}

function filterBranches(branches: Branch[], query: string): Branch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return branches;
  }

  return branches.filter((b) => b.name.toLowerCase().includes(normalizedQuery));
}

export function GitHubRepositoryBranchField({
  repoUrl,
  branch,
  onRepoUrlChange,
  onBranchChange,
  integration,
  disabled = false,
}: GitHubRepositoryBranchFieldProps) {
  const [isBranchListOpen, setIsBranchListOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const branchSearchRef = useRef<HTMLInputElement>(null);

  const branchSourceRef = useRef<"empty" | "default" | "manual" | "url">("empty");
  const repoIdentityRef = useRef("");

  const parsedRepository = useMemo(() => parseGitHubRepositoryInput(repoUrl), [repoUrl]);
  const hasGitHubUrl = repoUrl.trim().length > 0;
  const accessMode = integration ? "integration" : "public";

  // -- data fetching --

  const repositoryQuery = useQuery({
    ...trpc.github.resolveRepository.queryOptions({
      repositoryUrl: parsedRepository?.normalizedUrl ?? "",
      gitIntegrationId: integration?.gitIntegrationId,
    }),
    enabled: !!integration && !!parsedRepository,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const resolvedRepository = repositoryQuery.data?.repository as
    | ResolvedGitHubRepository
    | undefined;

  const branchesQuery = useQuery({
    ...trpc.github.listBranches.queryOptions({
      installationId: integration?.providerInstallationId ?? "",
      owner: resolvedRepository?.owner ?? parsedRepository?.owner ?? "",
      repo: resolvedRepository?.repo ?? parsedRepository?.repo ?? "",
    }),
    enabled: !!integration && !!resolvedRepository && isBranchListOpen,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const filteredBranches = useMemo(
    () => filterBranches((branchesQuery.data?.branches ?? []) as Branch[], branchQuery),
    [branchesQuery.data?.branches, branchQuery],
  );

  // -- sync branch state --

  const repositoryIdentity = `${parsedRepository?.normalizedUrl ?? ""}::${parsedRepository?.branchFromUrl ?? ""}::${accessMode}::${integration?.gitIntegrationId ?? ""}`;

  useEffect(() => {
    if (repoIdentityRef.current === repositoryIdentity) {
      return;
    }
    repoIdentityRef.current = repositoryIdentity;
    setIsBranchListOpen(false);
    setBranchQuery("");

    const nextBranch = parsedRepository?.branchFromUrl ?? "";
    branchSourceRef.current = parsedRepository?.branchFromUrl ? "url" : "empty";

    if (branch !== nextBranch) {
      onBranchChange(nextBranch);
    }
  }, [branch, onBranchChange, parsedRepository?.branchFromUrl, repositoryIdentity]);

  useEffect(() => {
    if (!integration || !resolvedRepository?.defaultBranch || parsedRepository?.branchFromUrl) {
      return;
    }
    if (branchSourceRef.current === "manual") {
      return;
    }
    if (branch !== resolvedRepository.defaultBranch) {
      branchSourceRef.current = "default";
      onBranchChange(resolvedRepository.defaultBranch);
    }
  }, [
    branch,
    integration,
    onBranchChange,
    parsedRepository?.branchFromUrl,
    resolvedRepository?.defaultBranch,
  ]);

  // focus branch search when opened
  useEffect(() => {
    if (isBranchListOpen && branchSearchRef.current) {
      setTimeout(() => branchSearchRef.current?.focus(), 0);
    }
  }, [isBranchListOpen]);

  const activeBranch =
    branch || parsedRepository?.branchFromUrl || resolvedRepository?.defaultBranch || "";

  const handleManualBranchChange = (value: string) => {
    branchSourceRef.current = value.trim() ? "manual" : "empty";
    onBranchChange(value);
  };

  const handleBranchSelect = (value: string) => {
    branchSourceRef.current = value === resolvedRepository?.defaultBranch ? "default" : "manual";
    onBranchChange(value);
    setIsBranchListOpen(false);
    setBranchQuery("");
  };

  // -- decide what the branch row looks like --

  const showBranchPicker = !!parsedRepository;
  const branchFromUrl = parsedRepository?.branchFromUrl;
  const isResolvingRepo = !!integration && !!parsedRepository && repositoryQuery.isLoading;
  const resolveError = !!integration && !!parsedRepository && repositoryQuery.error;
  const canPickBranch = !!integration && !!resolvedRepository && !branchFromUrl;

  return (
    <div className="grid gap-4">
      {/* ── Repository URL ── */}
      <div className="grid gap-1.5">
        <Label htmlFor="repo" className="text-sm font-medium">
          GitHub Repository URL
        </Label>
        <Input
          id="repo"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(event) => onRepoUrlChange(event.target.value)}
          disabled={disabled}
        />
        {/* inline validation hint */}
        <div className="min-h-5 text-xs">
          {parsedRepository ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Github className="h-3 w-3" />
              {parsedRepository.fullName}
              {branchFromUrl ? (
                <Badge
                  variant="secondary"
                  className="ml-1 gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0 text-[11px] text-emerald-300"
                >
                  <GitBranch className="h-2.5 w-2.5" />
                  {branchFromUrl}
                </Badge>
              ) : null}
            </span>
          ) : hasGitHubUrl ? (
            <span className="inline-flex items-center gap-1 text-amber-400/80">
              <AlertCircle className="h-3 w-3" />
              Enter a valid GitHub URL
            </span>
          ) : (
            <span className="text-muted-foreground/60">
              Paste a URL &mdash; <code className="text-[11px]">/tree/branch</code> links set the
              branch automatically
            </span>
          )}
        </div>
      </div>

      {/* ── Branch ── */}
      {showBranchPicker ? (
        <div className="grid gap-1.5">
          <Label className="text-sm font-medium">Branch</Label>

          {branchFromUrl ? (
            /* branch pinned from URL */
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm">
              <GitBranch className="h-4 w-4 text-emerald-400" />
              <span className="font-medium text-emerald-200">{branchFromUrl}</span>
              <span className="text-xs text-emerald-200/60">from URL</span>
            </div>
          ) : isResolvingRepo ? (
            /* loading default branch */
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Resolving default branch...
            </div>
          ) : resolveError ? (
            /* could not resolve -- fall back to manual input */
            <div className="grid gap-2">
              <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{repositoryQuery.error?.message}</span>
              </div>
              <Input
                placeholder="main"
                value={branch}
                onChange={(event) => handleManualBranchChange(event.target.value)}
                disabled={disabled}
              />
            </div>
          ) : canPickBranch ? (
            /* integration resolved -- show picker trigger */
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsBranchListOpen((open) => !open)}
                disabled={disabled}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border bg-secondary/20 px-3 py-2 text-sm transition-colors hover:bg-secondary/40",
                  isBranchListOpen
                    ? "rounded-b-none border-b-transparent border-border/60"
                    : "border-border/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground">{activeBranch}</span>
                  {(!branch || branch === resolvedRepository?.defaultBranch) && (
                    <span className="text-xs text-muted-foreground">default</span>
                  )}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isBranchListOpen && "rotate-180",
                  )}
                />
              </button>

              {isBranchListOpen ? (
                <div className="absolute inset-x-0 top-full z-20 rounded-b-md border border-t-0 border-border/60 bg-popover shadow-lg">
                  <div className="border-b border-border/30 p-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        ref={branchSearchRef}
                        value={branchQuery}
                        onChange={(event) => setBranchQuery(event.target.value)}
                        placeholder="Search branches..."
                        className="h-8 pl-8 text-sm"
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <ScrollArea className="max-h-52">
                    {branchesQuery.isLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading branches...
                      </div>
                    ) : filteredBranches.length > 0 ? (
                      <div className="p-1">
                        {filteredBranches.map((item) => {
                          const isSelected = item.name === activeBranch;
                          return (
                            <button
                              key={item.name}
                              type="button"
                              onClick={() => handleBranchSelect(item.name)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors hover:bg-secondary/60",
                                isSelected && "bg-secondary/50",
                              )}
                            >
                              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate text-left font-medium">
                                {item.name}
                              </span>
                              {isSelected ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {branchQuery ? `No branches match "${branchQuery}"` : "No branches found"}
                      </p>
                    )}
                  </ScrollArea>
                </div>
              ) : null}
            </div>
          ) : (
            /* public mode -- simple text input */
            <Input
              placeholder="Leave empty for the repo default (usually main)"
              value={branch}
              onChange={(event) => handleManualBranchChange(event.target.value)}
              disabled={disabled}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

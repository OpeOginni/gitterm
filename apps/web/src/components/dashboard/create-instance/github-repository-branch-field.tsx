"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronDown, GitBranch, Loader2, Lock, Search } from "lucide-react";
import { GitHub as Github } from "@/components/logos/Github";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Branch, Repository, ResolvedGitHubRepository } from "./types";
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

/** Score a repo against the query for sorting (exact > prefix > contains). */
function scoreRepoMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 200;
  return 0;
}

function filterRepos(repos: Repository[], query: string): Repository[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return repos.slice(0, 20);
  }
  return repos
    .map((repo) => ({
      repo,
      score: Math.max(scoreRepoMatch(trimmed, repo.fullName), scoreRepoMatch(trimmed, repo.name)),
    }))
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((item) => item.repo);
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

  const [isRepoListOpen, setIsRepoListOpen] = useState(false);
  const repoFieldRef = useRef<HTMLDivElement>(null);
  const branchFieldRef = useRef<HTMLDivElement>(null);

  const branchSourceRef = useRef<"empty" | "default" | "manual" | "url">("empty");
  const repoIdentityRef = useRef("");

  const parsedRepository = useMemo(() => parseGitHubRepositoryInput(repoUrl), [repoUrl]);
  const hasGitHubUrl = repoUrl.trim().length > 0;
  const accessMode = integration ? "integration" : "public";

  // -- data fetching --

  // Accessible repos for the selected integration -- powers the searchable
  // combobox. Public mode (no integration) falls back to URL paste only.
  const reposQuery = useQuery({
    ...trpc.github.listAccessibleRepos.queryOptions({
      installationId: integration?.providerInstallationId ?? "",
    }),
    enabled: !!integration,
    staleTime: 5 * 60 * 1000,
  });

  const accessibleRepos = (reposQuery.data?.repos ?? []) as Repository[];

  const filteredRepos = useMemo(
    () => filterRepos(accessibleRepos, repoUrl),
    [repoUrl, accessibleRepos],
  );

  const repositoryQuery = useQuery({
    ...trpc.github.resolveRepository.queryOptions({
      repositoryUrl: parsedRepository?.normalizedUrl ?? "",
      gitIntegrationId: integration?.gitIntegrationId,
    }),
    enabled: !!integration && !!parsedRepository,
    staleTime: 5 * 60 * 1000,
    retry: false,
    meta: { skipGlobalErrorToast: true },
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

  useEffect(() => {
    if (!isRepoListOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (repoFieldRef.current && !repoFieldRef.current.contains(event.target as Node)) {
        setIsRepoListOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isRepoListOpen]);

  // close branch dropdown on outside click
  useEffect(() => {
    if (!isBranchListOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (branchFieldRef.current && !branchFieldRef.current.contains(event.target as Node)) {
        setIsBranchListOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isBranchListOpen]);

  const handleRepoSelect = (repo: Repository) => {
    onRepoUrlChange(repo.htmlUrl);
    setIsRepoListOpen(false);
  };

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
      {/* ── Repository (search or paste URL) ── */}
      <div className="grid gap-1.5" ref={repoFieldRef}>
        <Label htmlFor="repo" className="text-sm font-medium">
          GitHub Repository
        </Label>
        <div className="relative">
          <Input
            id="repo"
            placeholder={
              integration ? "Search your repos or paste a URL" : "https://github.com/owner/repo"
            }
            value={repoUrl}
            onChange={(event) => {
              onRepoUrlChange(event.target.value);
              if (integration) setIsRepoListOpen(true);
            }}
            onFocus={() => {
              if (integration) setIsRepoListOpen(true);
            }}
            disabled={disabled}
            autoComplete="off"
          />

          {/* searchable repo dropdown (integration mode only) */}
          {integration && isRepoListOpen && !parsedRepository && (
            <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border/60 bg-popover shadow-md">
              <div className="max-h-60 overflow-y-auto overscroll-contain">
                {reposQuery.isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading repositories...
                  </div>
                ) : filteredRepos.length > 0 ? (
                  <div className="p-1">
                    {filteredRepos.map((repo) => (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => handleRepoSelect(repo)}
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors hover:bg-secondary/60"
                      >
                        <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-left font-medium">
                          {repo.fullName}
                        </span>
                        {repo.private && (
                          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    ))}
                    {!repoUrl.trim() && accessibleRepos.length > 20 && (
                      <div className="border-t border-border/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
                        Type to search {accessibleRepos.length} repositories
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {repoUrl.trim()
                      ? "No repos match — paste a URL to use any repository"
                      : "No repositories available"}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
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
              {integration
                ? "Search your connected repos, or paste any GitHub URL"
                : "Paste a URL — /tree/branch links set the branch automatically"}
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
                <span>Repo not found — enter the branch manually</span>
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
            <div className="relative" ref={branchFieldRef}>
              <button
                type="button"
                onClick={() => setIsBranchListOpen((open) => !open)}
                disabled={disabled}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border border-border/40 bg-secondary/20 px-3 py-2 text-sm transition-colors hover:bg-secondary/40",
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

              {isBranchListOpen && (
                <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border/60 bg-popover shadow-md">
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

                  <div className="max-h-60 overflow-y-auto overscroll-contain p-1">
                    {branchesQuery.isLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading branches...
                      </div>
                    ) : filteredBranches.length > 0 ? (
                      filteredBranches.map((item) => {
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
                      })
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {branchQuery ? `No branches match "${branchQuery}"` : "No branches found"}
                      </p>
                    )}
                  </div>
                </div>
              )}
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

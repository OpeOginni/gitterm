"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  GitBranch,
  Loader2,
  Lock,
  Plus,
  Search,
} from "lucide-react";
import { GitHub as Github } from "@/components/logos/Github";
import { trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/** Shared styling for both dropdown surfaces. Sized to the anchor, capped to the viewport. */
const DROPDOWN_CONTENT_CLASS =
  "flex w-(--radix-popover-trigger-width) max-h-[min(22rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden rounded-md border border-border/60 bg-popover p-0 shadow-md";

/** Row styling: taller on touch screens so rows are comfortable to tap. */
const ROW_CLASS =
  "flex w-full items-center gap-2 rounded-sm px-3 py-2.5 text-sm transition-colors hover:bg-secondary/60 sm:py-1.5";

/** Programmatic focus doesn't open the keyboard on touch devices, so only autofocus with a mouse. */
function hasFinePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

function filterBranches(branches: Branch[], query: string, defaultBranch?: string): Branch[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery
    ? branches.filter((b) => b.name.toLowerCase().includes(normalizedQuery))
    : branches;

  if (!defaultBranch) {
    return matches;
  }
  // Default branch first, remaining in GitHub's (alphabetical) order.
  return matches.toSorted((a, b) => {
    if (a.name === defaultBranch) return -1;
    if (b.name === defaultBranch) return 1;
    return 0;
  });
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
    () =>
      filterBranches(
        (branchesQuery.data?.branches ?? []) as Branch[],
        branchQuery,
        resolvedRepository?.defaultBranch,
      ),
    [branchesQuery.data?.branches, branchQuery, resolvedRepository?.defaultBranch],
  );

  // Offer the typed name as a branch when it isn't in the list -- covers
  // repos past the fetch cap and branches pushed since the list was cached.
  const trimmedBranchQuery = branchQuery.trim();
  const showUseTypedBranch =
    trimmedBranchQuery.length > 0 &&
    !branchesQuery.isLoading &&
    !filteredBranches.some((b) => b.name === trimmedBranchQuery);

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

  const handleBranchListOpenChange = (open: boolean) => {
    setIsBranchListOpen(open);
    if (!open) setBranchQuery("");
  };

  // -- decide what the branch row looks like --

  const showBranchPicker = !!parsedRepository;
  const branchFromUrl = parsedRepository?.branchFromUrl;
  const isResolvingRepo = !!integration && !!parsedRepository && repositoryQuery.isLoading;
  const resolveError = !!integration && !!parsedRepository && repositoryQuery.error;
  const canPickBranch = !!integration && !!resolvedRepository && !branchFromUrl;
  const isRepoDropdownOpen = !!integration && isRepoListOpen && !parsedRepository;

  return (
    <div className="grid gap-4">
      {/* ── Repository (search or paste URL) ── */}
      <div className="grid gap-1.5" ref={repoFieldRef}>
        <Label htmlFor="repo" className="text-sm font-medium">
          GitHub Repository
        </Label>
        <Popover open={isRepoDropdownOpen} onOpenChange={setIsRepoListOpen}>
          <PopoverAnchor asChild>
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
            </div>
          </PopoverAnchor>

          {/* searchable repo dropdown (integration mode only) */}
          <PopoverContent
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className={DROPDOWN_CONTENT_CLASS}
            // keep focus (and the keyboard) in the input while the list is open
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              // taps on the input itself shouldn't close the list
              if (repoFieldRef.current?.contains(event.target as Node)) {
                event.preventDefault();
              }
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                      className={ROW_CLASS}
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
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {repoUrl.trim()
                    ? "No repos match — paste a URL to use any repository"
                    : "No repositories available"}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
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
              <AlertCircle className="h-3 w-3 text-amber-400 opacity-80" />
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
            <Popover open={isBranchListOpen} onOpenChange={handleBranchListOpenChange}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="flex w-full items-center justify-between rounded-md border border-border/40 bg-secondary/20 px-3 py-2 text-sm transition-colors hover:bg-secondary/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{activeBranch}</span>
                    {(!branch || branch === resolvedRepository?.defaultBranch) && (
                      <span className="shrink-0 text-xs text-muted-foreground">default</span>
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      isBranchListOpen && "rotate-180",
                    )}
                  />
                </button>
              </PopoverTrigger>

              <PopoverContent
                align="start"
                sideOffset={4}
                collisionPadding={8}
                className={DROPDOWN_CONTENT_CLASS}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  if (hasFinePointer()) branchSearchRef.current?.focus();
                }}
              >
                <div className="shrink-0 border-b border-border/30 p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={branchSearchRef}
                      value={branchQuery}
                      onChange={(event) => setBranchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && showUseTypedBranch) {
                          event.preventDefault();
                          handleBranchSelect(trimmedBranchQuery);
                        }
                      }}
                      placeholder="Search branches..."
                      className="h-9 pl-8 text-sm sm:h-8"
                      disabled={disabled}
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                  {branchesQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading branches...
                    </div>
                  ) : (
                    <>
                      {filteredBranches.map((item) => {
                        const isSelected = item.name === activeBranch;
                        return (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => handleBranchSelect(item.name)}
                            className={cn(ROW_CLASS, isSelected && "bg-secondary/50")}
                          >
                            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-left font-medium">
                              {item.name}
                            </span>
                            {item.name === resolvedRepository?.defaultBranch ? (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                default
                              </span>
                            ) : null}
                            {isSelected ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                            ) : null}
                          </button>
                        );
                      })}

                      {filteredBranches.length === 0 && !showUseTypedBranch ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No branches found
                        </p>
                      ) : null}

                      {showUseTypedBranch ? (
                        <button
                          type="button"
                          onClick={() => handleBranchSelect(trimmedBranchQuery)}
                          className={cn(
                            ROW_CLASS,
                            "text-muted-foreground",
                            filteredBranches.length > 0 && "mt-1 border-t border-border/30",
                          )}
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-left">
                            Use{" "}
                            <span className="font-medium text-foreground">
                              {trimmedBranchQuery}
                            </span>
                            {filteredBranches.length === 0 ? " — no matching branches" : ""}
                          </span>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
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

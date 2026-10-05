"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { Check, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { GitHub as Github } from "@/components/logos/Github";
import { Button } from "@/components/ui/button";
import { GITHUB_RETURN_TO_KEY, githubInstallUrl } from "../github-connection";
import {
  GitHubRepositoryBranchField,
  type GitIntegrationSelection,
} from "../create-instance/github-repository-branch-field";
import type { GitInstallation } from "../create-instance/types";

type Installation = GitInstallation & {
  github_app_installation?: { accountType?: string | null } | null;
};

const tileClass =
  "flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors";

function useConnectGitHub() {
  const [connecting, setConnecting] = useState(false);
  const { data: availability, isLoading } = useQuery(trpc.github.appAvailability.queryOptions());
  const connect = () => {
    setConnecting(true);
    sessionStorage.setItem(GITHUB_RETURN_TO_KEY, "/dashboard/bots");
    window.location.href = githubInstallUrl(availability?.slug);
  };
  return { availability, isLoading, connecting, connect };
}

/** Shown before any GitHub account is connected: what connecting unlocks, and one button. */
function ConnectGitHubPrompt() {
  const { availability, isLoading, connecting, connect } = useConnectGitHub();

  if (isLoading || !availability?.enabled) return null;
  if (availability.mode === "pat") {
    return (
      <div className={cn(tileClass, "border-line bg-fill")}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-fill-2">
          <Github className="size-4 text-fg" fill="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">Shared GitHub access</span>
          <span className="block truncate text-[13px] text-fg-3">
            {availability.accountLogin ? `@${availability.accountLogin} · ` : ""}set up by your
            admin
          </span>
        </span>
        <Check className="size-4 shrink-0 text-primary" />
      </div>
    );
  }
  if (!availability.configured) {
    return (
      <p className="text-[13px] text-fg-3">
        Your admin has not set up GitHub access. Public repositories still work.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-fill p-4 sm:flex-row sm:items-center">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-fill-2">
        <Github className="size-5 text-fg" fill="currentColor" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[15px] font-medium text-fg">Connect GitHub</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-3">
          {["Private repositories", "Push branches", "Open pull requests"].map((item) => (
            <span key={item} className="flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" />
              {item}
            </span>
          ))}
        </p>
      </div>
      <Button className="h-10 gap-2 text-sm" onClick={connect} disabled={connecting}>
        {connecting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Github className="size-4" fill="currentColor" />
        )}
        Connect GitHub
      </Button>
    </div>
  );
}

/** Connected accounts as tiles: pick whose repositories to browse, or add another account. */
function GitHubAccounts({
  installations,
  selectedId,
  onSelect,
}: {
  installations: Installation[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { connecting, connect } = useConnectGitHub();
  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup">
        {installations.map((installation) => {
          const { id, providerAccountLogin: login } = installation.git_integration;
          const selected = id === selectedId;
          const type = installation.github_app_installation?.accountType;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(id)}
              className={cn(
                tileClass,
                selected
                  ? "border-primary/60 bg-fill"
                  : "border-line hover:border-fg-4 hover:bg-fill",
              )}
            >
              <Image
                src={`https://github.com/${login}.png?size=72`}
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 rounded-full border border-line object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">@{login}</span>
                <span className="block text-[13px] text-fg-3">
                  {type === "Organization" ? "Organization" : "Personal"}
                </span>
              </span>
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-primary" : "border-fg-4",
                )}
              >
                {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={connect}
          disabled={connecting}
          className={cn(
            tileClass,
            "border-dashed border-line text-fg-3 hover:border-fg-4 hover:bg-fill hover:text-fg-2",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line">
            {connecting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Add account</span>
            <span className="block truncate text-[13px] text-fg-4">Another user or org</span>
          </span>
        </button>
      </div>
      <p className="text-xs text-fg-4">
        Pick whose repositories to browse. The bot uses the account that owns the repository.
      </p>
    </div>
  );
}

export function RepositoryStepBody({
  githubEnabled,
  repoUrl,
  branch,
  onRepoUrlChange,
  onBranchChange,
}: {
  githubEnabled: boolean;
  repoUrl: string;
  branch: string;
  onRepoUrlChange: (value: string) => void;
  onBranchChange: (value: string) => void;
}) {
  const { data } = useQuery({
    ...trpc.workspace.listUserInstallations.queryOptions(),
    enabled: githubEnabled,
  });
  const installations = (data?.installations ?? []) as Installation[];
  const [installationId, setInstallationId] = useState<string>();
  const installation =
    installations.find((candidate) => candidate.git_integration.id === installationId) ??
    installations[0];
  const integration: GitIntegrationSelection | null = installation
    ? {
        gitIntegrationId: installation.git_integration.id,
        providerInstallationId: installation.git_integration.providerInstallationId,
        label: installation.git_integration.providerAccountLogin,
      }
    : null;

  return (
    <div className="space-y-5">
      {githubEnabled ? (
        installations.length === 0 ? (
          <ConnectGitHubPrompt />
        ) : (
          <GitHubAccounts
            installations={installations}
            selectedId={installation?.git_integration.id}
            onSelect={setInstallationId}
          />
        )
      ) : null}
      <GitHubRepositoryBranchField
        repoUrl={repoUrl}
        branch={branch}
        onRepoUrlChange={onRepoUrlChange}
        onBranchChange={onBranchChange}
        integration={integration}
      />
    </div>
  );
}

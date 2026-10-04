"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { GitHub as Github } from "@/components/logos/Github";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GITHUB_RETURN_TO_KEY, githubInstallUrl } from "../github-connection";
import {
  GitHubRepositoryBranchField,
  type GitIntegrationSelection,
} from "../create-instance/github-repository-branch-field";
import type { GitInstallation } from "../create-instance/types";

function GitHubStatus() {
  const [connecting, setConnecting] = useState(false);
  const { data: availability, isLoading } = useQuery(trpc.github.appAvailability.queryOptions());

  const connect = () => {
    setConnecting(true);
    sessionStorage.setItem(GITHUB_RETURN_TO_KEY, "/dashboard/bots");
    window.location.href = githubInstallUrl(availability?.slug);
  };

  if (isLoading || !availability?.enabled) return null;
  if (availability.mode === "pat") {
    return (
      <p className="flex items-center gap-2 text-[13px] text-fg-2">
        <Check className="size-3.5 text-primary" />
        GitHub access is shared by your admin
        {availability.accountLogin ? ` (@${availability.accountLogin})` : ""}.
      </p>
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-fill px-3.5 py-3">
      <p className="flex items-center gap-2 text-[13px] text-fg-3">
        <Github className="size-4 shrink-0 text-fg-2" fill="currentColor" />
        Connect GitHub so the agent can open private repositories and push.
      </p>
      <Button size="sm" className="gap-1.5" onClick={connect} disabled={connecting}>
        {connecting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Connect GitHub
      </Button>
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
  const installations = (data?.installations ?? []) as GitInstallation[];
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
    <div className="space-y-4">
      {githubEnabled ? (
        installations.length === 0 ? (
          <GitHubStatus />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[13px] text-fg-2">
              <Check className="size-3.5 text-primary" />
              GitHub connected
            </p>
            {installations.length > 1 ? (
              <Select value={installation?.git_integration.id} onValueChange={setInstallationId}>
                <SelectTrigger className="h-8 w-auto min-w-44 border-line bg-input/70 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {installations.map((candidate) => (
                    <SelectItem
                      key={candidate.git_integration.id}
                      value={candidate.git_integration.id}
                    >
                      @{candidate.git_integration.providerAccountLogin}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-mono text-xs text-fg-3">@{integration?.label}</span>
            )}
          </div>
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

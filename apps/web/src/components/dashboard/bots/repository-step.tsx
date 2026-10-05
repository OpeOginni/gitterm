"use client";

import type React from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { KeyRound, Loader2, Plus } from "lucide-react";
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

export type GitHubAccess = "connection" | "token";

const eyebrowClass = "font-mono text-[11px] uppercase tracking-[0.18em] text-fg-4";

function AccessTile({
  selected,
  onSelect,
  icon,
  title,
  status,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  status: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
        selected ? "border-primary/60 bg-fill" : "border-line hover:border-fg-4 hover:bg-fill",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-fill-2 text-fg">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block truncate text-[13px] text-fg-3">{status}</span>
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
}

/** A connected account as a pill: whose repositories the search box browses. */
function AccountPill({
  login,
  selected,
  onSelect,
}: {
  login: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] transition-colors",
        selected
          ? "border-primary/60 bg-fill text-fg"
          : "border-line text-fg-3 hover:border-fg-4 hover:text-fg-2",
      )}
    >
      <span className="relative shrink-0">
        <Image
          src={`https://github.com/${login}.png?size=48`}
          alt=""
          width={24}
          height={24}
          className="size-6 rounded-full object-cover"
        />
        <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full border-2 border-card bg-fg">
          <Github className="size-2 text-background" fill="currentColor" />
        </span>
      </span>
      @{login}
    </button>
  );
}

export function RepositoryStepBody({
  access,
  onAccessChange,
  githubEnabled,
  repoUrl,
  branch,
  onRepoUrlChange,
  onBranchChange,
}: {
  access: GitHubAccess;
  onAccessChange: (access: GitHubAccess) => void;
  githubEnabled: boolean;
  repoUrl: string;
  branch: string;
  onRepoUrlChange: (value: string) => void;
  onBranchChange: (value: string) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const { data: availability } = useQuery({
    ...trpc.github.appAvailability.queryOptions(),
    enabled: githubEnabled,
  });
  const { data } = useQuery({
    ...trpc.workspace.listUserInstallations.queryOptions(),
    enabled: githubEnabled,
  });
  const installations = (data?.installations ?? []) as GitInstallation[];
  const [installationId, setInstallationId] = useState<string>();
  const installation =
    installations.find((candidate) => candidate.git_integration.id === installationId) ??
    installations[0];
  const integration: GitIntegrationSelection | null =
    access === "connection" && installation
      ? {
          gitIntegrationId: installation.git_integration.id,
          providerInstallationId: installation.git_integration.providerInstallationId,
          label: installation.git_integration.providerAccountLogin,
        }
      : null;

  const shared = availability?.mode === "pat";
  const canConnect = githubEnabled && !shared && availability?.configured === true;
  const connectionStatus = installations.length
    ? installations.map((entry) => `@${entry.git_integration.providerAccountLogin}`).join(", ")
    : shared
      ? `Shared by your admin${availability?.accountLogin ? ` (@${availability.accountLogin})` : ""}`
      : canConnect
        ? "Not connected"
        : "Public repositories only";

  const connect = () => {
    setConnecting(true);
    sessionStorage.setItem(GITHUB_RETURN_TO_KEY, "/dashboard/bots");
    window.location.href = githubInstallUrl(availability?.slug);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className={eyebrowClass}>GitHub access</p>
        <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup">
          <AccessTile
            selected={access === "connection"}
            onSelect={() => onAccessChange("connection")}
            icon={<Github className="size-[18px]" fill="currentColor" />}
            title="GitHub connection"
            status={connectionStatus}
          />
          <AccessTile
            selected={access === "token"}
            onSelect={() => onAccessChange("token")}
            icon={<KeyRound className="size-[18px]" />}
            title="Your own token"
            status="Goes in the bot's .env"
          />
        </div>

        {access === "token" ? (
          <p className="text-[13px] text-fg-3">
            Paste it into <span className="font-mono text-fg-2">GITTERM_BOT_GITHUB_TOKEN</span>.
            Classic tokens need the repo scope; fine-grained ones Contents and Pull requests.
            GitTerm doesn't save it.
          </p>
        ) : installations.length ? (
          <div className="flex flex-wrap items-center gap-2" role="radiogroup">
            {installations.map((entry) => (
              <AccountPill
                key={entry.git_integration.id}
                login={entry.git_integration.providerAccountLogin}
                selected={entry.git_integration.id === installation?.git_integration.id}
                onSelect={() => setInstallationId(entry.git_integration.id)}
              />
            ))}
            <Link
              href={"/dashboard/integrations" as Route}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-[13px] text-fg-3 transition-colors hover:border-fg-4 hover:text-fg-2"
            >
              <Plus className="size-3.5" />
              Add
            </Link>
            <span className="text-xs text-fg-4">The bot uses the account that owns the repo.</span>
          </div>
        ) : canConnect ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-4">
              Private repos · Push branches · Pull requests
            </p>
            <Button size="sm" className="h-8 gap-1.5" onClick={connect} disabled={connecting}>
              {connecting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Connect GitHub
            </Button>
          </div>
        ) : null}
      </div>

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

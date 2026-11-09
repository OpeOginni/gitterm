"use client";

import type React from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Check, KeyRound, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";
import { GitHub as Github } from "@/components/logos/Github";
import { Button } from "@/components/ui/button";
import { Seg } from "@/components/site/seg";
import { GITHUB_RETURN_TO_KEY, githubInstallUrl } from "../github-connection";
import {
  GitHubRepositoryBranchField,
  type GitIntegrationSelection,
} from "../create-instance/github-repository-branch-field";
import type { GitInstallation } from "../create-instance/types";

export type GitHubAccess = "connection" | "token";

type Installation = GitInstallation & {
  github_app_installation?: { accountType?: string | null } | null;
};

const tileClass =
  "flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-[background-color,box-shadow]";

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border",
        selected ? "border-primary" : "border-fg-4",
      )}
    >
      {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

/** How the bot reaches GitHub. */
function AccessSwitch({
  access,
  onChange,
}: {
  access: GitHubAccess;
  onChange: (access: GitHubAccess) => void;
}) {
  return (
    <Seg
      ariaLabel="GitHub access"
      value={access}
      onChange={onChange}
      options={[
        { value: "connection", label: "Connection" },
        { value: "token", label: "Own token" },
      ]}
    />
  );
}

/** Connected accounts as tiles: pick whose repositories to browse, or add another. */
function AccountTiles({
  installations,
  selectedId,
  onSelect,
}: {
  installations: Installation[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup">
        {installations.map((installation) => {
          const { id, providerAccountLogin: login } = installation.git_integration;
          const selected = id === selectedId;
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
                  ? "bg-fill-2 shadow-[inset_0_0_0_1px_rgba(211,173,85,0.5)]"
                  : "bg-fill hover:bg-fill-2",
              )}
            >
              <span className="relative shrink-0">
                <Image
                  src={`https://github.com/${login}.png?size=72`}
                  alt=""
                  width={36}
                  height={36}
                  className="size-9 rounded-full object-cover"
                />
                <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border-2 border-card bg-fg">
                  <Github className="size-2.5 text-background" fill="currentColor" />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">@{login}</span>
                <span className="block text-[13px] text-fg-3">
                  {installation.github_app_installation?.accountType === "Organization"
                    ? "Organization"
                    : "Personal"}
                </span>
              </span>
              <Radio selected={selected} />
            </button>
          );
        })}
        <Link
          href={"/dashboard/integrations" as Route}
          className={cn(tileClass, "text-fg-3 hover:bg-fill hover:text-fg-2")}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill-2">
            <Plus className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Add account</span>
            <span className="block truncate text-[13px] text-fg-4">In Integrations</span>
          </span>
        </Link>
      </div>
      <p className="text-[12.5px] text-fg-4">
        Pick whose repositories to browse. The bot uses the account that owns the repo.
      </p>
    </div>
  );
}

/** One row for the methods that need no picking: an icon, what it is, and an action. */
function AccessRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill-2 text-fg">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{title}</p>
          <div className="mt-0.5 text-[13px] text-fg-3">{detail}</div>
        </div>
      </div>
      {action ? (
        <div className="shrink-0 [&>button]:w-full sm:[&>button]:w-auto">{action}</div>
      ) : null}
    </div>
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
  const installations = (data?.installations ?? []) as Installation[];
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

  const connect = () => {
    if (!availability?.slug) return;
    setConnecting(true);
    sessionStorage.setItem(GITHUB_RETURN_TO_KEY, "/dashboard/bots");
    window.location.href = githubInstallUrl(availability.slug);
  };

  const githubIcon = <Github className="size-[18px]" fill="currentColor" />;
  const accessBody =
    access === "token" ? (
      <AccessRow
        icon={<KeyRound className="size-[18px]" />}
        title="Your own token"
        detail={
          <>
            Paste it into <span className="font-mono text-fg-2">GITTERM_BOT_GITHUB_TOKEN</span> in
            the .env. Gitterm doesn't save it.
          </>
        }
      />
    ) : installations.length ? (
      <AccountTiles
        installations={installations}
        selectedId={installation?.git_integration.id}
        onSelect={setInstallationId}
      />
    ) : availability?.mode === "pat" ? (
      <AccessRow
        icon={githubIcon}
        title="Shared GitHub access"
        detail={`${availability.accountLogin ? `@${availability.accountLogin}, ` : ""}set up by your admin`}
        action={<Check className="size-4 text-primary" />}
      />
    ) : githubEnabled && availability?.configured ? (
      <AccessRow
        icon={githubIcon}
        title="Connect GitHub"
        detail="Private repositories, pushing branches and opening pull requests."
        action={
          <Button className="h-9 gap-2" onClick={connect} disabled={connecting}>
            {connecting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Connect
          </Button>
        }
      />
    ) : (
      <AccessRow
        icon={githubIcon}
        title="Public repositories only"
        detail="GitHub isn't set up here. Use your own token for private repositories."
      />
    );

  return (
    <div className="space-y-5">
      <div className="space-y-3.5 border-b border-line pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-fg-2">GitHub access</p>
          <AccessSwitch access={access} onChange={onAccessChange} />
        </div>
        {accessBody}
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

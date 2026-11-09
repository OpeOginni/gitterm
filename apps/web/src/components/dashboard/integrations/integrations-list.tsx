"use client";

import type React from "react";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Blocks, ChevronDown, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { GitHubConnection, GitHubTitle } from "@/components/dashboard/github-connection";
import { GoogleCloudConnection } from "@/components/dashboard/google-cloud-connection";
import { SettingsEmpty } from "@/components/dashboard/settings/settings-page";
import { Panel, SectionHeading, StatusDot } from "@/components/dashboard/kit";
import { McpConnections } from "./mcp-connections";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/utils/trpc";

/**
 * One integration as a row: name, what it gives agents, and how many are connected. It opens
 * in place to add or manage connections, so the page stays short as integrations are added.
 */
function IntegrationRow({
  icon,
  name,
  description,
  connected,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  connected: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-fill sm:px-5"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-fg">{name}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-fg-3 sm:truncate">
            {description}
          </span>
        </span>
        {connected > 0 ? (
          <StatusDot tone="ok" className="shrink-0">
            {connected} connected
          </StatusDot>
        ) : (
          <span className="shrink-0 text-[13px] font-medium text-fg-3 transition-colors group-hover:text-fg">
            Set up
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-fg-4 transition-transform",
            open && "rotate-180 text-fg-2",
          )}
        />
      </button>
      {open ? <div className="border-t border-line px-4 py-5 sm:px-5">{children}</div> : null}
    </div>
  );
}

/** The page's real headings over cards shaped like the loaded ones. */
function IntegrationsSkeleton() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <SectionHeading
          title={<GitHubTitle />}
          description="Repository access for your workspaces."
        />
        <Skeleton className="h-[88px] w-full rounded-xl bg-fill" />
      </section>
      <section className="space-y-4">
        <SectionHeading
          title="Tools and identities"
          description="Your agents connect to these directly."
        />
        <Panel>
          {[0, 1].map((index) => (
            <div key={index} className="flex items-center gap-3.5 px-4 py-4 sm:px-5">
              <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32 bg-fill-2" />
                <Skeleton className="h-3.5 w-72 max-w-full bg-fill-2" />
              </div>
            </div>
          ))}
        </Panel>
      </section>
    </div>
  );
}

/**
 * Renders only the integrations the admin has enabled. Disabled and not-yet-built
 * integrations never appear here; the admin catalog is the place to manage them.
 */
export function IntegrationsList() {
  const { data: session } = authClient.useSession();
  const { data: catalog, isLoading } = useQuery(trpc.integrations.list.queryOptions());
  const { data: googleAvailability, isLoading: isLoadingGoogle } = useQuery(
    trpc.googleCloud.availability.queryOptions(),
  );
  const { data: connections = [] } = useQuery(trpc.integrations.connections.list.queryOptions());
  const count = (key: string) =>
    connections.filter((connection) => connection.integration === key).length;

  if (isLoading || isLoadingGoogle) return <IntegrationsSkeleton />;

  const isEnabled = (key: string) =>
    catalog?.some((integration) => integration.key === key && integration.enabled) === true;

  const showGitHub = isEnabled("github");
  const showGoogle = isEnabled("google") && googleAvailability?.available === true;
  const showMcp = isEnabled("mcp");
  const showExecutor = isEnabled("executor");

  if (!showGitHub && !showGoogle && !showMcp && !showExecutor) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <SettingsEmpty
          icon={<Plug />}
          title="No integrations turned on"
          description="Your admin chooses which ones are available. Workspaces can still clone public repositories."
        />
        {session?.user.role === "admin" ? (
          <Link
            href={"/admin/integrations" as Route}
            className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-medium text-primary hover:underline"
          >
            Turn some on
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {showGitHub ? <GitHubConnection /> : null}

      {showGoogle || showExecutor || showMcp ? (
        <section className="space-y-4">
          <SectionHeading
            title="Tools and identities"
            description="Your agents connect to these directly."
          />
          <Panel>
            {showGoogle ? (
              <IntegrationRow
                icon={<Image src="/google-cloud.svg" alt="" width={18} height={18} />}
                name="Google Cloud"
                description="Keyless gcloud access through Workload Identity Federation"
                connected={count("google")}
              >
                <GoogleCloudConnection embedded />
              </IntegrationRow>
            ) : null}
            {showExecutor ? (
              <IntegrationRow
                icon={<Image src="/executor.png" alt="" width={18} height={18} />}
                name="Executor"
                description="Your whole Executor tool catalog through one connection"
                connected={count("executor")}
              >
                <McpConnections allowCustom={false} allowExecutor embedded />
              </IntegrationRow>
            ) : null}
            {showMcp ? (
              <IntegrationRow
                icon={<Blocks className="size-4 text-fg-2" />}
                name="MCP servers"
                description="Remote MCP tools your agents connect to directly"
                connected={count("mcp")}
              >
                <McpConnections allowCustom allowExecutor={false} embedded />
              </IntegrationRow>
            ) : null}
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

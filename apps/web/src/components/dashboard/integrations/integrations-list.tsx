"use client";

import { SettingsEmptyState } from "@/components/ui/form-card";
import type React from "react";
import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Blocks, ChevronDown, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { GitHubConnection } from "@/components/dashboard/github-connection";
import { GoogleCloudConnection } from "@/components/dashboard/google-cloud-connection";
import { McpConnections } from "./mcp-connections";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/utils/trpc";

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4">
        {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

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
        className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-fill"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-fill-2">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">{name}</span>
          <span className="block truncate text-xs text-fg-4">{description}</span>
        </span>
        {connected > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">
            <span className="size-1.5 rounded-full bg-primary" />
            {connected} connected
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-4 transition-colors group-hover:text-primary">
            Add
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-fg-4 transition-transform",
            open && "rotate-180 text-fg-2",
          )}
        />
      </button>
      {open ? <div className="border-t border-line px-4 py-5">{children}</div> : null}
    </div>
  );
}

function IntegrationsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-7 rounded-full bg-fill-2" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-20 bg-fill-2" />
          <Skeleton className="h-3 w-56 bg-fill" />
        </div>
      </div>
      <div className="rounded-xl border border-line bg-settings p-5">
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-11 rounded-full bg-fill-2" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 bg-fill-2" />
            <Skeleton className="h-3 w-24 bg-fill" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-8">
          <Skeleton className="h-10 bg-fill" />
          <Skeleton className="h-10 bg-fill" />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <SettingsEmptyState
      icon={Plug}
      title="No integrations available"
      description="This deployment has not turned on any integrations yet. Your workspaces can still clone public repositories."
    />
  );
}

/**
 * Renders only the integrations the admin has enabled. Disabled and not-yet-built
 * integrations never appear here; the admin catalog is the place to manage them.
 */
export function IntegrationsList() {
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

  if (!showGitHub && !showGoogle && !showMcp && !showExecutor) return <EmptyState />;

  return (
    <>
      {showGitHub ? (
        <section className="space-y-4">
          <SectionEyebrow>Repository</SectionEyebrow>
          <GitHubConnection />
        </section>
      ) : null}

      {showGoogle || showExecutor || showMcp ? (
        <section className="space-y-4">
          <SectionEyebrow>Identity and tools</SectionEyebrow>
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-settings">
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
          </div>
        </section>
      ) : null}
    </>
  );
}

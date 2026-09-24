"use client";

import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { GitHubConnection } from "@/components/dashboard/github-connection";
import { GoogleCloudConnection } from "@/components/dashboard/google-cloud-connection";
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-fill px-6 py-14 text-center">
      <Plug className="size-5 text-fg-4" />
      <p className="text-sm font-medium text-fg-2">No integrations available</p>
      <p className="max-w-sm text-sm text-fg-4">
        This deployment has not turned on any integrations yet. Your workspaces can still clone
        public repositories.
      </p>
    </div>
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

  if (isLoading || isLoadingGoogle) return <IntegrationsSkeleton />;

  const isEnabled = (key: string) =>
    catalog?.some((integration) => integration.key === key && integration.enabled) === true;

  const showGitHub = isEnabled("github");
  const showGoogle = isEnabled("google") && googleAvailability?.available === true;

  if (!showGitHub && !showGoogle) return <EmptyState />;

  return (
    <>
      {showGitHub ? (
        <section className="space-y-4">
          <SectionEyebrow>Git providers</SectionEyebrow>
          <GitHubConnection />
        </section>
      ) : null}

      {showGoogle ? (
        <section className="space-y-4">
          <SectionEyebrow>Cloud identity</SectionEyebrow>
          <GoogleCloudConnection />
        </section>
      ) : null}
    </>
  );
}

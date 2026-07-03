"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, UsersRound } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { InstanceCard } from "@/components/dashboard/instance-list";

export function SharedWorkspaces() {
  const sharedQuery = useQuery(trpc.workspaceShare.listSharedWorkspaces.queryOptions());
  const providersQuery = useQuery(trpc.workspace.listCloudProviders.queryOptions());

  if (sharedQuery.isLoading || providersQuery.isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    );
  }

  const workspaces = sharedQuery.data?.workspaces ?? [];
  const providers = providersQuery.data?.cloudProviders ?? [];

  if (workspaces.length === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
          <UsersRound className="h-7 w-7 text-white/30" />
        </div>
        <h3 className="mt-5 text-lg font-medium text-white/80">Nothing shared with you yet</h3>
        <p className="mt-2 max-w-sm text-sm text-white/35">
          When a teammate shares a workspace with you or your team, it will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,420px))]">
      {workspaces.map(({ access, ...workspace }) => (
        <InstanceCard
          key={workspace.id}
          workspace={workspace}
          providers={providers}
          shared={access}
        />
      ))}
    </div>
  );
}

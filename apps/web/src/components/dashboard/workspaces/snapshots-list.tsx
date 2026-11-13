"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspaces } from "./use-active-workspaces";

/**
 * Saved machine images. The sandbox plugin and the SDK save one after a project's setup, and
 * cloud workspaces keep one per repository, so new machines start with dependencies installed.
 */
export function SnapshotsList() {
  const snapshotsQuery = useQuery(trpc.sandbox.snapshots.queryOptions());
  const { data: providersData } = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  const { data: workspacesData } = useActiveWorkspaces();
  const { data: billing } = useQuery(trpc.billing.account.queryOptions());
  const [confirming, setConfirming] = useState<string | null>(null);

  const remove = useMutation(
    trpc.sandbox.deleteSnapshot.mutationOptions({
      onSuccess: () => {
        toast.success("Snapshot deleted");
        setConfirming(null);
        void queryClient.invalidateQueries({ queryKey: trpc.sandbox.snapshots.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });
      },
      onError: (error) => toast.error(`Couldn't delete the snapshot: ${error.message}`),
    }),
  );

  if (snapshotsQuery.isLoading) {
    return (
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
            <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-48 max-w-full bg-fill-2" />
              <Skeleton className="h-3 w-64 max-w-full bg-fill-2" />
            </div>
            <Skeleton className="h-8 w-16 rounded-lg bg-fill-2" />
          </li>
        ))}
      </ul>
    );
  }

  const snapshots = snapshotsQuery.data ?? [];
  const providers = providersData?.cloudProviders ?? [];
  const workspaces = workspacesData?.workspaces ?? [];
  const limit = billing?.entitlements.maxSnapshots ?? null;

  const sizeOf = (machineProfileId: string | null) => {
    for (const provider of providers) {
      const profile = provider.machineProfiles.find((p) => p.id === machineProfileId);
      if (profile) return { size: profile.name, provider: provider.name };
    }
    return null;
  };

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-line px-6 py-14 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-fill">
          <Layers className="size-[18px] text-fg-3" />
        </span>
        <h2 className="mt-4 font-display text-[18px] font-semibold tracking-[-0.01em] text-fg">
          No snapshots yet
        </h2>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-fg-3">
          {limit === 0
            ? "Snapshots are on paid plans."
            : "Your agent saves one after setting up a project, and cloud workspaces keep one per repository, so the next machine starts ready."}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {limit !== null && limit > 0 && (
        <p className="text-[13px] text-fg-3 tabular-nums">
          {snapshots.length} of {limit} on your plan
        </p>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {snapshots.map((snapshot) => {
          const where = sizeOf(snapshot.machineProfileId);
          const inUse = workspaces.filter((w) => w.snapshotId === snapshot.id).length;
          return (
            <li key={snapshot.id} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                <Layers className="size-4 text-fg-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13.5px] text-fg">{snapshot.label}</p>
                <p className="mt-1 text-[12.5px] text-fg-4">
                  {[
                    // A cloud workspace kept for its repository, not a sandbox snapshot.
                    snapshot.repositoryUrl ? "cloud workspace" : null,
                    where ? `${where.size} on ${where.provider}` : null,
                    `saved ${formatDistanceToNow(new Date(snapshot.createdAt), { addSuffix: true })}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="hidden shrink-0 text-[12.5px] text-fg-3 sm:block">
                {inUse
                  ? `Used by ${inUse} ${snapshot.repositoryUrl ? "workspace" : "sandbox"}${inUse === 1 ? "" : snapshot.repositoryUrl ? "s" : "es"}`
                  : "Not in use"}
              </p>
              {confirming === snapshot.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ snapshotId: snapshot.id })}
                  >
                    {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Delete
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => setConfirming(snapshot.id)}
                >
                  Delete
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

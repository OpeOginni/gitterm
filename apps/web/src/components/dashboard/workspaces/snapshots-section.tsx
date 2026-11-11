"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/dashboard/kit";
import { isSandbox, type CloudProvider, type Workspace } from "./workspace-meta";

/**
 * Saved agent sandboxes. The sandbox plugin and the SDK save one after a project's setup, so
 * new sandboxes start with its dependencies already installed.
 */
export function SnapshotsSection({
  workspaces,
  providers,
}: {
  workspaces: Workspace[];
  providers: CloudProvider[];
}) {
  const { data: snapshots = [] } = useQuery(trpc.sandbox.snapshots.queryOptions());
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

  const limit = billing?.entitlements.maxSnapshots ?? null;
  // Nothing to show to someone who neither has snapshots nor uses agent sandboxes.
  if (snapshots.length === 0 && !workspaces.some(isSandbox)) return null;

  const sizeOf = (machineProfileId: string | null) => {
    for (const provider of providers) {
      const profile = provider.machineProfiles.find((p) => p.id === machineProfileId);
      if (profile) return { size: profile.name, provider: provider.name };
    }
    return null;
  };

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Snapshots"
        count={snapshots.length || undefined}
        description={
          limit === 0
            ? "Snapshots are on paid plans."
            : limit !== null
              ? `${snapshots.length} of ${limit} on your plan. New agent sandboxes, and cloud workspaces for a repository, start from them with dependencies installed.`
              : "New agent sandboxes, and cloud workspaces for a repository, start from them with dependencies installed."
        }
      />
      {snapshots.length === 0 ? (
        <p className="rounded-xl border border-line px-4 py-4 text-[13.5px] leading-relaxed text-fg-3 sm:px-5">
          None yet. Your agent saves one after setting up a project, so its next sandbox starts
          ready.
        </p>
      ) : (
        <ul className="max-h-[480px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
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
      )}
    </section>
  );
}

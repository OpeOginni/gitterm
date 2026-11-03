"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Loader2, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { SettingsGroup } from "@/components/dashboard/settings/settings-page";

function StatCell({
  label,
  value,
  sub,
  isLoading,
}: {
  label: string;
  value: number;
  sub: string;
  isLoading: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-fg-3">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1.5 h-8 w-14 bg-fill" />
      ) : (
        <p className="mt-1 text-[28px] font-medium tracking-tight tabular-nums text-fg">{value}</p>
      )}
      <p className="text-[12.5px] text-fg-4">{sub}</p>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();

  useEffect(() => {
    if (!isSessionPending) {
      if (!session?.user) {
        router.push("/login");
        return;
      }
      if ((session.user as any)?.role !== "admin") {
        router.push("/dashboard");
      }
    }
  }, [session, isSessionPending, router]);

  const queryClient = useQueryClient();
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => trpcClient.admin.users.stats.query(),
  });

  const cleanupAnonMutation = useMutation({
    mutationFn: () => trpcClient.admin.users.cleanupAnonStragglers.mutate(),
    onSuccess: ({ found, terminated }) => {
      if (found === 0) {
        toast.success("No anon stragglers found.");
      } else {
        toast.success(
          `Terminated ${terminated} of ${found} anon ${found === 1 ? "workspace" : "workspaces"}.`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (error) => {
      toast.error(`Cleanup failed: ${error.message}`);
    },
  });

  if (isSessionPending || !session?.user || (session.user as any)?.role !== "admin") {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48 bg-fill" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Overview"
        text="The deployment at a glance. Everything else is under Admin in the sidebar."
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-6 rounded-2xl bg-card p-5 sm:grid-cols-4 sm:p-6">
        <StatCell
          label="Total users"
          value={stats?.users.total ?? 0}
          sub={`${stats?.users.admins ?? 0} admins`}
          isLoading={isLoading}
        />
        <StatCell
          label="Active"
          value={stats?.workspaces.running ?? 0}
          sub={`${stats?.workspaces.total ?? 0} total`}
          isLoading={isLoading}
        />
        <StatCell
          label="Paid"
          value={stats?.users.paid ?? 0}
          sub={`${stats?.users.free ?? 0} free`}
          isLoading={isLoading}
        />
        <StatCell
          label="Paused"
          value={stats?.workspaces.paused ?? stats?.workspaces.stopped ?? 0}
          sub="can resume"
          isLoading={isLoading}
        />
      </div>

      {/* Maintenance row */}
      <SettingsGroup
        title="Anon stragglers"
        description="Terminate any try‑gitterm sandboxes that outlived their 10‑min lease (E2B webhook / reaper safety net)."
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => cleanupAnonMutation.mutate()}
            disabled={cleanupAnonMutation.isPending}
            className="gap-2"
          >
            {cleanupAnonMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {cleanupAnonMutation.isPending ? "Sweeping…" : "Sweep now"}
          </Button>
        }
      />
    </DashboardShell>
  );
}

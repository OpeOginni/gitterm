"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

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

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => trpcClient.admin.users.stats.query(),
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
    </DashboardShell>
  );
}

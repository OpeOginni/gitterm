import { Suspense } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { UsageMetrics } from "@/components/dashboard/usage-metrics";
import { UsageHistory } from "@/components/dashboard/usage-history";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

function MetricsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-2xl bg-white/[0.04]" />
      ))}
    </div>
  );
}

function HistorySkeleton() {
  return <Skeleton className="h-80 rounded-2xl bg-white/[0.04]" />;
}

export default async function UsagePage() {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");

  const session = await authClient.getSession({
    fetchOptions: {
      headers: cookie ? { cookie } : {},
    },
  });

  if (!session.data?.user) {
    redirect("/login");
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Usage & Billing"
        text="Monitor your workspace usage and quota."
      />
      <div className="mx-auto max-w-4xl space-y-6 pt-2">
        <Suspense fallback={<MetricsSkeleton />}>
          <UsageMetrics />
        </Suspense>
        <Suspense fallback={<HistorySkeleton />}>
          <UsageHistory />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

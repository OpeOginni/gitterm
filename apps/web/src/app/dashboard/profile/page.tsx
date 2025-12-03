import { Suspense } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { UsageMetrics } from "@/components/dashboard/usage-metrics";
import { UsageHistory } from "@/components/dashboard/usage-history";
import { Skeleton } from "@/components/ui/skeleton";

function MetricsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  );
}

function HistorySkeleton() {
  return <Skeleton className="h-96" />;
}

export default function ProfilePage() {
  return (
    <DashboardShell>
      <DashboardHeader
        heading="Usage & Billing"
        text="Monitor your workspace usage and free tier quota."
      />
      <div className="grid gap-8">
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


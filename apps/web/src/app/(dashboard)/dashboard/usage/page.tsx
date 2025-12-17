import { Suspense } from "react"
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell"
import { UsageMetrics } from "@/components/dashboard/usage-metrics"
import { UsageHistory } from "@/components/dashboard/usage-history"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth-client"
import { redirect } from "next/navigation"
import { headers } from "next/headers"

function MetricsSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-32 bg-secondary/30" />
      ))}
    </div>
  )
}

function HistorySkeleton() {
  return <Skeleton className="h-96 bg-secondary/30" />
}

export default async function UsagePage() {
  const session = await authClient.getSession({
    fetchOptions:{
      headers: await headers()
    }
  })

  if(!session.data?.user) {
    redirect("/login")
  }


  return (
    <DashboardShell>
      <DashboardHeader heading="Usage & Billing" text="Monitor your workspace usage and quota." />
      <div className="grid gap-8">
        <Suspense fallback={<MetricsSkeleton />}>
          <UsageMetrics />
        </Suspense>

        <Suspense fallback={<HistorySkeleton />}>
          <UsageHistory />
        </Suspense>
      </div>
    </DashboardShell>
  )
}

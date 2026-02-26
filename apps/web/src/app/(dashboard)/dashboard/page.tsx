import { Suspense } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { InstanceList } from "@/components/dashboard/instance-list";
import { CreateInstanceDialog } from "@/components/dashboard/create-instance/create-instance-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { cookies } from 'next/headers'

function InstanceListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
        >
          <Skeleton className="mb-4 h-5 w-28 bg-white/[0.04]" />
          <Skeleton className="mb-2 h-4 w-full bg-white/[0.04]" />
          <Skeleton className="mb-4 h-4 w-3/4 bg-white/[0.04]" />
          <Skeleton className="h-9 w-full bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
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
        heading="Workspaces"
        text="Create and manage your remote development environments."
      >
        
        <CreateInstanceDialog />
      </DashboardHeader>
      <Suspense fallback={<InstanceListSkeleton />}>
        <InstanceList />
      </Suspense>
    </DashboardShell>
  );
}

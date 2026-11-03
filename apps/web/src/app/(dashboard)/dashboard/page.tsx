import { Suspense } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { InstanceList } from "@/components/dashboard/instance-list";
import { CreateInstanceDialog } from "@/components/dashboard/create-instance/create-instance-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

function InstanceListSkeleton() {
  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,420px))]">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl bg-fill-2" />
            <Skeleton className="h-5 w-32 bg-fill-2" />
          </div>
          <div className="space-y-2 pl-12">
            <Skeleton className="h-4 w-full bg-fill-2" />
            <Skeleton className="h-4 w-3/4 bg-fill-2" />
          </div>
          <Skeleton className="mt-5 h-9 w-full bg-fill-2" />
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

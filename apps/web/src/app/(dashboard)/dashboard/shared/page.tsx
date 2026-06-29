import { Suspense } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { SharedWorkspaces } from "@/components/dashboard/share/shared-workspaces";
import { authClient } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function SharedWorkspacesPage() {
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
        heading="Shared with me"
        text="Workspaces other people and teams have shared with you."
      />
      <Suspense fallback={null}>
        <SharedWorkspaces />
      </Suspense>
    </DashboardShell>
  );
}

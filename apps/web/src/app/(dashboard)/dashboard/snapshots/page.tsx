import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { SnapshotsList } from "@/components/dashboard/workspaces/snapshots-list";
import { authClient } from "@/lib/auth-client";

export default async function SnapshotsPage() {
  const cookie = (await headers()).get("cookie");
  const session = await authClient.getSession({
    fetchOptions: { headers: cookie ? { cookie } : {} },
  });
  if (!session.data?.user) redirect("/login");

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Snapshots"
        text="Saved machines that new agent sandboxes and cloud workspaces start from, with dependencies already installed."
      />
      <SnapshotsList />
    </DashboardShell>
  );
}

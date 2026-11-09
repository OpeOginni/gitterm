import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { InstanceList } from "@/components/dashboard/instance-list";
import { authClient } from "@/lib/auth-client";

export default async function SandboxesPage() {
  const cookie = (await headers()).get("cookie");
  const session = await authClient.getSession({
    fetchOptions: { headers: cookie ? { cookie } : {} },
  });
  if (!session.data?.user) redirect("/login");

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Agent sandboxes"
        text="Machines your agent or code starts to run builds, tests and previews. They clean up after themselves."
      />
      <InstanceList kind="sandboxes" />
    </DashboardShell>
  );
}

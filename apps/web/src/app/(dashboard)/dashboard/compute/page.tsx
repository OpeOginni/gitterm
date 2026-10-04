import { redirect } from "next/navigation";
import { DefaultCloudProviderSection } from "@/components/dashboard/default-cloud-provider-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { getServerSession } from "@/lib/server-session";

export default async function ComputePage() {
  const session = await getServerSession();
  if (!session.data?.user) redirect("/login");

  return (
    <SettingsShell>
      <SettingsPage
        title="Compute"
        description="Where new workspaces and bot sandboxes run by default."
      >
        <DefaultCloudProviderSection />
      </SettingsPage>
    </SettingsShell>
  );
}

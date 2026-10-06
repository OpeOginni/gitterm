import { redirect } from "next/navigation";
import { ModelCredentialsSection } from "@/components/dashboard/model-credentials-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { getServerSession } from "@/lib/server-session";

export default async function ModelsPage() {
  const session = await getServerSession();
  if (!session.data?.user) redirect("/login");

  return (
    <SettingsShell>
      <SettingsPage
        title="Models"
        description="The model keys and subscriptions your workspaces and bots run on."
      >
        <ModelCredentialsSection />
      </SettingsPage>
    </SettingsShell>
  );
}

import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { ProvidersSection } from "@/components/dashboard/settings/workspace-section";

export default function ProviderSettingsPage() {
  return (
    <SettingsPage
      title="Providers"
      description="Choose your default cloud and manage the model credentials available to workspaces."
    >
      <ProvidersSection />
    </SettingsPage>
  );
}

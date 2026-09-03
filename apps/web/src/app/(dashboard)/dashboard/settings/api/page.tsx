import { ApiSection } from "@/components/dashboard/settings/api-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";

export default function ApiSettingsPage() {
  return (
    <SettingsPage
      title="API & tokens"
      description="Create credentials for the GitTerm CLI, SDK, and your own automations."
    >
      <ApiSection />
    </SettingsPage>
  );
}

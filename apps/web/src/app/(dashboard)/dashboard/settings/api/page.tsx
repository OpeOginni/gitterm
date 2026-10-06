import { ApiSection } from "@/components/dashboard/settings/api-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";

export default function ApiSettingsPage() {
  return (
    <SettingsPage
      title="API tokens"
      description="Scoped credentials for the CLI, SDK, and your automations. Tokens from gitterm login appear here too."
    >
      <ApiSection />
    </SettingsPage>
  );
}

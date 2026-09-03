import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { TeamsSection } from "@/components/dashboard/settings/teams-section";

export default function TeamSettingsPage() {
  return (
    <SettingsPage title="Teams" description="Organize collaborators and manage shared access.">
      <TeamsSection />
    </SettingsPage>
  );
}

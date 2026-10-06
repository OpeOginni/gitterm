import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { WorkspaceHistory } from "@/components/dashboard/settings/usage-section";

export default function WorkspaceHistoryPage() {
  return (
    <SettingsPage
      title="Workspace history"
      description="Active and terminated workspaces across all your providers."
    >
      <WorkspaceHistory />
    </SettingsPage>
  );
}

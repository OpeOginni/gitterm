import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { AgentDefaultsSection } from "@/components/dashboard/settings/workspace-section";

export default function AgentDefaultSettingsPage() {
  return (
    <SettingsPage
      title="Agent defaults"
      description="Maintain reusable configuration files applied when agents start."
    >
      <AgentDefaultsSection />
    </SettingsPage>
  );
}

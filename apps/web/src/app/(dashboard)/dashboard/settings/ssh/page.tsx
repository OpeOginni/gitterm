import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { SshSettingsSection } from "@/components/dashboard/settings/workspace-section";

export default function SshSettingsPage() {
  return (
    <SettingsPage
      title="SSH keys"
      description="Manage the public key used for direct editor and terminal access."
    >
      <SshSettingsSection />
    </SettingsPage>
  );
}

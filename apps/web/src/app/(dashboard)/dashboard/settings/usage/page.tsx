import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { UsageSection } from "@/components/dashboard/settings/usage-section";

export default function UsageSettingsPage() {
  return (
    <SettingsPage
      title="Usage"
      description="Monitor runtime allowance and review workspace activity."
    >
      <UsageSection />
    </SettingsPage>
  );
}

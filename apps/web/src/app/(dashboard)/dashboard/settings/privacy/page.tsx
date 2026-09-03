import { PrivacySection } from "@/components/dashboard/settings/privacy-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";

export default function PrivacySettingsPage() {
  return (
    <SettingsPage title="Privacy" description="Control analytics and review how GitTerm uses data.">
      <PrivacySection />
    </SettingsPage>
  );
}

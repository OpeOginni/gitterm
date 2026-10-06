import { AccountSection } from "@/components/dashboard/settings/account-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";

export default function AccountSettingsPage() {
  return (
    <SettingsPage title="Account" description="Your profile, plan, usage, and account controls.">
      <AccountSection />
    </SettingsPage>
  );
}

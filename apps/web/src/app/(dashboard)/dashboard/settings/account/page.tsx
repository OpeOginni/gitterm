import { AccountSection } from "@/components/dashboard/settings/account-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { getServerSession } from "@/lib/server-session";

export default async function AccountSettingsPage() {
  const session = await getServerSession();
  const currentPlan = ((session.data?.user as { plan?: "free" | "starter" | "pro" } | undefined)
    ?.plan ?? "free") as "free" | "starter" | "pro";

  return (
    <SettingsPage title="Account" description="Your identity and account-level controls.">
      <AccountSection currentPlan={currentPlan} />
    </SettingsPage>
  );
}

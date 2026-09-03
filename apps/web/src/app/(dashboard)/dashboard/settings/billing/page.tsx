import { BillingSection } from "@/components/dashboard/billing-section";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { getServerSession } from "@/lib/server-session";

export default async function BillingSettingsPage() {
  const session = await getServerSession();
  const currentPlan = ((session.data?.user as { plan?: "free" | "starter" | "pro" } | undefined)
    ?.plan ?? "free") as "free" | "starter" | "pro";

  return (
    <SettingsPage
      title="Billing"
      description="Review your plan, included limits, and subscription controls."
    >
      <BillingSection currentPlan={currentPlan} />
    </SettingsPage>
  );
}

import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { DeleteAccountSection } from "@/components/dashboard/delete-account";
import { BillingSection, RunPacksSection } from "@/components/dashboard/billing-section";
import { AgentConfigSection } from "@/components/dashboard/agent-config-section";
import { ModelCredentialsSection } from "@/components/dashboard/model-credentials-section";
import { authClient } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

type UserPlan = "free" | "pro";

export default async function SettingsPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
    },
  });

  if (!session.data?.user) {
    redirect("/login");
  }

  // Get user's current plan (default to 'free' if not set)
  const currentPlan = ((session.data.user as any).plan as UserPlan) || "free";

  return (
    <DashboardShell>
      <DashboardHeader heading="Settings" text="Manage your account settings and preferences." />
      <div className="pt-8 mx-auto max-w-4xl space-y-8">
        <BillingSection currentPlan={currentPlan} />
        <ModelCredentialsSection />
        <AgentConfigSection />
        <RunPacksSection currentPlan={currentPlan} />
        <DeleteAccountSection />
      </div>
    </DashboardShell>
  );
}

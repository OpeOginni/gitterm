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
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");

  const session = await authClient.getSession({
    fetchOptions: {
      headers: cookie ? { cookie } : {},
    },
  });

  if (!session.data?.user) {
    redirect("/login");
  }

  const currentPlan = ((session.data.user as any).plan as UserPlan) || "free";

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Settings"
        text="Manage your account, model providers, and preferences."
      />
      <div className="mx-auto max-w-4xl space-y-6 pt-2">
        <BillingSection currentPlan={currentPlan} />
        <ModelCredentialsSection />
        <AgentConfigSection />
        <RunPacksSection currentPlan={currentPlan} />
        <DeleteAccountSection />
      </div>
    </DashboardShell>
  );
}

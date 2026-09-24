import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { IntegrationCallbackHandler } from "@/components/dashboard/integrations/integration-callback-handler";
import { IntegrationsList } from "@/components/dashboard/integrations/integrations-list";
import { authClient } from "@/lib/auth-client";

export default async function IntegrationsPage() {
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

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Integrations"
        text="Connect the services your workspaces pull code from."
      />
      <div className="mx-auto max-w-4xl space-y-10 pt-2">
        <Suspense fallback={null}>
          <IntegrationCallbackHandler />
        </Suspense>
        <IntegrationsList />
      </div>
    </DashboardShell>
  );
}

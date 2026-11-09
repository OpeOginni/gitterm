import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { IntegrationCallbackHandler } from "@/components/dashboard/integrations/integration-callback-handler";
import { IntegrationsList } from "@/components/dashboard/integrations/integrations-list";
import { SettingsPage } from "@/components/dashboard/settings/settings-page";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
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
    <SettingsShell>
      <SettingsPage
        title="Integrations"
        description="Connect repository access, cloud identities, and tools for your agents."
      >
        <Suspense fallback={null}>
          <IntegrationCallbackHandler />
        </Suspense>
        <IntegrationsList />
      </SettingsPage>
    </SettingsShell>
  );
}

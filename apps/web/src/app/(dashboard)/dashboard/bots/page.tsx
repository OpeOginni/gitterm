import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { BotSetup } from "@/components/dashboard/bots/bot-setup";
import { authClient } from "@/lib/auth-client";

export default async function BotsPage() {
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
        heading="Bots"
        text="Run a coding agent on your repository from Slack or Discord."
      />
      <div className="mx-auto max-w-4xl pt-2">
        <BotSetup />
      </div>
    </DashboardShell>
  );
}

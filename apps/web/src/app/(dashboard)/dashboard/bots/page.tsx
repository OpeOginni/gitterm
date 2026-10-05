import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Plus } from "lucide-react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { BotList } from "@/components/dashboard/bots/bot-list";
import { Button } from "@/components/ui/button";
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
      >
        <Button asChild className="gap-2">
          <Link href={"/dashboard/bots/new" as Route}>
            <Plus className="size-4" />
            New bot
          </Link>
        </Button>
      </DashboardHeader>
      <BotList />
    </DashboardShell>
  );
}

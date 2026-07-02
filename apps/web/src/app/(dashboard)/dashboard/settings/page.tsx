import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { authClient } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
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

  const { section } = await searchParams;
  const currentPlan = ((session.data.user as any).plan as "free" | "starter" | "pro") || "free";

  return <SettingsShell currentPlan={currentPlan} initialSection={section} />;
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { getServerSession } from "@/lib/server-session";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();

  if (!session.data?.user) {
    redirect("/login");
  }

  return <SettingsShell>{children}</SettingsShell>;
}

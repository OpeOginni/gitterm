import type React from "react";
import { AppSidebar } from "@/components/dashboard/sidebar/app-sidebar";
import { getServerSession } from "@/lib/server-session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Signed-out visitors get no sidebar: its queries would 401 before the page redirects to login.
  const session = await getServerSession();
  const signedIn = !!session.data?.user;

  return (
    <div className="min-h-screen bg-background text-white dark landing-grid">
      {signedIn && <AppSidebar />}
      <main className={signedIn ? "pt-14 md:pt-0 md:pl-60" : undefined}>{children}</main>
    </div>
  );
}

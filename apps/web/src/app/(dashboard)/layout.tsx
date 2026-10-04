import type React from "react";
import { AppSidebar } from "@/components/dashboard/sidebar/app-sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-white dark landing-grid">
      <AppSidebar />
      <main className="pt-14 md:pt-0 md:pl-60">{children}</main>
    </div>
  );
}

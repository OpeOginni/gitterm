import type React from "react";
import { DashboardNav } from "../../components/dashboard/nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#09090b] text-white dark landing-grid">
      <DashboardNav />
      <main className="pt-14">{children}</main>
    </div>
  );
}

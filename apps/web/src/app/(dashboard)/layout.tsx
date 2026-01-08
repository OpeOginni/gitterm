import type React from "react";
import { DashboardNav } from "../../components/dashboard/nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <main className="pt-16">{children}</main>
    </div>
  );
}

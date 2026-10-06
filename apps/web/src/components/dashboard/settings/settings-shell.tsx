import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/shell";

/** Settings pages are reached from the dashboard sidebar; the shell only sets their width. */
export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <DashboardShell>
      <div className="max-w-4xl">{children}</div>
    </DashboardShell>
  );
}

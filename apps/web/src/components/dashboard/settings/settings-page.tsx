import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/dashboard/shell";

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-8">
      <DashboardHeader heading={title} text={description} />
      {children}
    </section>
  );
}

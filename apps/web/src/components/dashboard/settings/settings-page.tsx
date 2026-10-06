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

/** A labelled part of a settings page, reachable by its anchor (e.g. from the plan badge). */
export function SettingsPart({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 space-y-3 pt-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">{label}</p>
      {children}
    </section>
  );
}

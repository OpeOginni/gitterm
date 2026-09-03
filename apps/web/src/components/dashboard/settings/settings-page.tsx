import type { ReactNode } from "react";

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
    <section className="space-y-6">
      <header className="max-w-2xl space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight text-fg md:text-2xl">{title}</h2>
        <p className="text-sm leading-relaxed text-fg-3">{description}</p>
      </header>
      {children}
    </section>
  );
}

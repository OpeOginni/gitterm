"use client";

import { ArrowUpRight, Code2, TerminalSquare } from "lucide-react";
import { ApiTokensSection } from "@/components/dashboard/api-tokens-section";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";

const packages = [
  {
    name: "@gitterm/cli",
    description: "Manage GitTerm workspaces and resources from your terminal.",
    href: "https://www.npmjs.com/package/@gitterm/cli",
    icon: TerminalSquare,
  },
  {
    name: "@gitterm/sdk",
    description: "Build GitTerm into your own applications and automations.",
    href: "https://www.npmjs.com/package/@gitterm/sdk",
    icon: Code2,
  },
];

export function ApiSection() {
  return (
    <div className="space-y-6">
      <ApiTokensSection />

      <SettingsSection
        eyebrow="02 / Developer tools"
        icon={TerminalSquare}
        title="Build with GitTerm"
        description="Use your API token with our official CLI and TypeScript SDK."
      >
        <SettingsSectionBody className="grid gap-3 lg:grid-cols-2">
          {packages.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.name}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-4 rounded-xl border border-white/[0.06] bg-input/50 p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-white/55 transition-colors group-hover:text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-medium text-white/85">{item.name}</span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-white/30 transition-colors group-hover:text-primary" />
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-white/45">
                    {item.description}
                  </span>
                  <span className="mt-3 block text-[10px] font-medium uppercase tracking-[0.18em] text-primary/70">
                    View on npm
                  </span>
                </span>
              </a>
            );
          })}
        </SettingsSectionBody>
      </SettingsSection>
    </div>
  );
}

"use client";

import { ArrowUpRight, Code2, TerminalSquare } from "lucide-react";
import { ApiTokensSection } from "@/components/dashboard/api-tokens-section";
import { SettingsGroup } from "./settings-page";

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

      <SettingsGroup
        title="Official tools"
        description="Use your API token with the GitTerm CLI and TypeScript SDK."
        bodyClassName="pt-2"
      >
        <div className="divide-y divide-line">
          {packages.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.name}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 py-3.5"
              >
                <Icon className="size-4 shrink-0 text-fg-3 transition-colors group-hover:text-fg" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="font-mono text-[14px] text-fg transition-colors group-hover:text-[#e2c47c]">
                    {item.name}
                  </span>
                  <span className="text-[13.5px] text-fg-3">{item.description}</span>
                </span>
                <span className="hidden text-[13px] text-fg-4 sm:block">npm</span>
                <ArrowUpRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
              </a>
            );
          })}
        </div>
      </SettingsGroup>
    </div>
  );
}

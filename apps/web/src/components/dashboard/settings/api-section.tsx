"use client";

import { ArrowUpRight, Code2, TerminalSquare } from "lucide-react";
import { ApiTokensSection } from "@/components/dashboard/api-tokens-section";

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
    <div className="space-y-10">
      <div className="rounded-xl border border-line bg-settings px-4 py-5 sm:px-6 sm:py-6">
        <ApiTokensSection />
      </div>

      <section className="space-y-3 border-t border-line pt-6">
        <div>
          <h3 className="text-base font-semibold text-fg">Official tools</h3>
          <p className="mt-1 text-[13px] text-fg-3">
            Use your API token with the GitTerm CLI and TypeScript SDK.
          </p>
        </div>
        <div className="divide-y divide-line">
          {packages.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.name}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 py-4 transition-colors hover:text-primary"
              >
                <Icon className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-sm font-medium text-fg transition-colors group-hover:text-primary">
                    {item.name}
                  </span>
                  <span className="ml-3 text-xs text-fg-3">{item.description}</span>
                </span>
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4 sm:block">
                  npm
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-primary" />
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}

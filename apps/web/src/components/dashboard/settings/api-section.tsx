"use client";

import Image from "next/image";
import { ArrowUpRight, Code2, TerminalSquare } from "lucide-react";
import { ApiTokensSection } from "@/components/dashboard/api-tokens-section";
import { CopyField } from "@/components/dashboard/copy-field";
import { INSTALL_CLOUD, INSTALL_SANDBOX } from "@/lib/site/providers";
import { SectionHeading } from "@/components/dashboard/kit";

const TOOLS = [
  {
    name: "@gitterm/cli",
    description: "Workspaces, sandboxes and tokens from your terminal.",
    install: "npm i -g @gitterm/cli",
    icon: <TerminalSquare className="size-4 text-fg-3" />,
  },
  {
    name: "@gitterm/sdk",
    description: "Build GitTerm into your own apps, scripts and CI.",
    install: "npm i @gitterm/sdk",
    icon: <Code2 className="size-4 text-fg-3" />,
  },
  {
    name: "@gitterm/opencode-sandbox",
    description: "Let OpenCode run builds, tests and previews in remote sandboxes.",
    install: INSTALL_SANDBOX,
    icon: <Image src="/opencode.svg" alt="" width={16} height={16} />,
  },
  {
    name: "@gitterm/opencode-cloud",
    description: "Move an OpenCode session to a cloud workspace with /cloud.",
    install: INSTALL_CLOUD,
    icon: <Image src="/opencode.svg" alt="" width={16} height={16} />,
  },
  {
    name: "@gitterm/slack-bot",
    description: "A coding agent your team mentions in Slack.",
    install: "npx @gitterm/slack-bot",
    icon: <Image src="/slack.svg" alt="" width={16} height={16} />,
  },
  {
    name: "@gitterm/discord-bot",
    description: "A coding agent your server mentions in Discord.",
    install: "npx @gitterm/discord-bot",
    icon: <Image src="/discord.svg" alt="" width={16} height={16} />,
  },
];

export function ApiSection() {
  return (
    <div className="space-y-12">
      <ApiTokensSection />

      <section className="space-y-4">
        <SectionHeading
          title="Official tools"
          description="Each one signs in with a token from this page."
        />
        {/* One row per tool so each install command fits on a single line. */}
        <ul className="divide-y divide-line rounded-xl border border-line">
          {TOOLS.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:gap-6"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                  {tool.icon}
                </span>
                <div className="min-w-0">
                  <a
                    href={`https://www.npmjs.com/package/${tool.name}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex max-w-full items-center gap-1 font-mono text-[13.5px] text-fg"
                  >
                    <span className="truncate">{tool.name}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
                  </a>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{tool.description}</p>
                </div>
              </div>
              <CopyField value={tool.install} className="lg:w-[30rem] lg:shrink-0" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

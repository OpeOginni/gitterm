"use client";

import Image from "next/image";
import { ArrowUpRight, Code2, TerminalSquare } from "lucide-react";
import { ApiTokensSection } from "@/components/dashboard/api-tokens-section";
import { CopyField } from "@/components/dashboard/copy-field";
import { INSTALL_CLOUD, INSTALL_SANDBOX } from "@/lib/site/providers";
import { LineCell, LineGrid, SectionHeading } from "@/components/dashboard/kit";

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
        <LineGrid className="md:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((tool) => (
            <LineCell key={tool.name} className="gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {tool.icon}
                </span>
                <span className="truncate font-mono text-[13.5px] text-fg">{tool.name}</span>
                <a
                  href={`https://www.npmjs.com/package/${tool.name}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12.5px] text-fg-3 transition-colors hover:text-fg"
                >
                  npm
                  <ArrowUpRight className="size-3.5" />
                </a>
              </div>
              <p className="text-[13.5px] leading-relaxed text-fg-3">{tool.description}</p>
              <CopyField multiline value={tool.install} className="mt-auto" />
            </LineCell>
          ))}
        </LineGrid>
      </section>
    </div>
  );
}

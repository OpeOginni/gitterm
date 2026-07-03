"use client";

import { Copy, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { ApiTokensSection } from "@/components/dashboard/api-tokens-section";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";

const CLI_SNIPPET = `export GITTERM_API_TOKEN=gt_...
gitterm workspace list --json`;

const SDK_SNIPPET = `import { createGittermClient } from "@gitterm/sdk";

const client = createGittermClient({
  token: process.env.GITTERM_API_TOKEN,
});

const { workspaces } = await client.workspaces.list();`;

function Snippet({ label, code }: { label: string; code: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-input/50">
      <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.015] px-3.5 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
          {label}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-white/35 hover:text-white/70"
          onClick={handleCopy}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-white/70">
        {code}
      </pre>
    </div>
  );
}

export function ApiSection() {
  return (
    <div className="space-y-6">
      <ApiTokensSection />

      <SettingsSection
        eyebrow="02 / Quick start"
        icon={TerminalSquare}
        title="Use your token"
        description="The same token works everywhere: the gitterm CLI, @gitterm/sdk, and any integration that talks to the GitTerm API."
      >
        <SettingsSectionBody className="grid gap-3 lg:grid-cols-2">
          <Snippet label="CLI" code={CLI_SNIPPET} />
          <Snippet label="SDK" code={SDK_SNIPPET} />
        </SettingsSectionBody>
      </SettingsSection>
    </div>
  );
}

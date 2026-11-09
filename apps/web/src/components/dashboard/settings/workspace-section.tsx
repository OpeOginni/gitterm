"use client";

import { SshKeySection } from "@/components/dashboard/ssh-key-section";
import { AgentConfigSection } from "@/components/dashboard/agent-config-section";
import { CommitAttributionSection } from "./commit-attribution-section";

export function AgentDefaultsSection() {
  return (
    <div className="space-y-12">
      <div id="configurations" className="scroll-mt-8">
        <AgentConfigSection />
      </div>
      <div id="commits" className="scroll-mt-8">
        <CommitAttributionSection />
      </div>
    </div>
  );
}

export function SshSettingsSection() {
  return (
    <div className="space-y-6">
      <SshKeySection />
    </div>
  );
}

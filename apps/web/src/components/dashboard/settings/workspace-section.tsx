"use client";

import { SshKeySection } from "@/components/dashboard/ssh-key-section";
import { AgentConfigSection } from "@/components/dashboard/agent-config-section";
import { CommitAttributionSection } from "./commit-attribution-section";
import { SettingsPart } from "./settings-page";

export function AgentDefaultsSection() {
  return (
    <div className="space-y-6">
      <SettingsPart id="configurations" label="Configurations">
        <AgentConfigSection />
      </SettingsPart>
      <SettingsPart id="commits" label="Commits">
        <CommitAttributionSection />
      </SettingsPart>
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

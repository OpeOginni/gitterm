"use client";

import { SshKeySection } from "@/components/dashboard/ssh-key-section";
import { AgentConfigSection } from "@/components/dashboard/agent-config-section";

export function AgentDefaultsSection() {
  return (
    <div className="space-y-6">
      <AgentConfigSection />
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

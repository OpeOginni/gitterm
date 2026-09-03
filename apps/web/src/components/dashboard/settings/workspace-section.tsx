"use client";

import { SshKeySection } from "@/components/dashboard/ssh-key-section";
import { ModelCredentialsSection } from "@/components/dashboard/model-credentials-section";
import { AgentConfigSection } from "@/components/dashboard/agent-config-section";
import { DefaultCloudProviderSection } from "@/components/dashboard/default-cloud-provider-section";

export function ProvidersSection() {
  return (
    <div className="space-y-6">
      <DefaultCloudProviderSection />
      <ModelCredentialsSection />
    </div>
  );
}

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

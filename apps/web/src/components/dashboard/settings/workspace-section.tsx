"use client";

import { SshKeySection } from "@/components/dashboard/ssh-key-section";
import { ModelCredentialsSection } from "@/components/dashboard/model-credentials-section";
import { AgentConfigSection } from "@/components/dashboard/agent-config-section";
import { DefaultCloudProviderSection } from "@/components/dashboard/default-cloud-provider-section";

export function WorkspaceSection() {
  return (
    <div className="space-y-6">
      <DefaultCloudProviderSection />
      <ModelCredentialsSection />
      <AgentConfigSection />
      <SshKeySection />
    </div>
  );
}

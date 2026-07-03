"use client";

import { UsersRound } from "lucide-react";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import { TeamsManager } from "@/components/dashboard/teams/teams-manager";

export function TeamsSection() {
  return (
    <div className="space-y-6">
      <SettingsSection
        eyebrow="Teams"
        title="Teams"
        description="Group collaborators and grant whole teams access to workspaces at once. Members accept one invite to join."
        icon={UsersRound}
      >
        <SettingsSectionBody>
          <TeamsManager />
        </SettingsSectionBody>
      </SettingsSection>
    </div>
  );
}

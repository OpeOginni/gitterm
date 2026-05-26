"use client";

import Link from "next/link";
import type { Route } from "next";
import { Shield, ExternalLink } from "lucide-react";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import { Switch } from "@/components/ui/switch";
import { useConsent } from "@/hooks/use-consent";
import { setConsent } from "@/lib/consent";
import { ANALYTICS_ENABLED } from "@/lib/analytics";
import { toast } from "sonner";

export function PrivacySection() {
  const { consent, ready } = useConsent();
  const analyticsOn = consent.analytics === "granted";

  const handleToggle = (next: boolean) => {
    setConsent({ analytics: next ? "granted" : "denied" });
    toast.success(next ? "Analytics enabled" : "Analytics disabled");
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        eyebrow="01 / Privacy"
        title="Analytics"
        description="Help us improve GitTerm by sharing anonymous product usage. You can change this any time."
        icon={Shield}
      >
        <SettingsSectionBody>
          {!ANALYTICS_ENABLED ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-white/55">
              Analytics is not configured on this deployment. Nothing is being collected.
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/90">
                  Share anonymous usage data
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-white/50">
                  Page views and feature events. No content from your workspaces, no
                  selling of data, no advertising.
                </p>
              </div>
              <Switch
                checked={analyticsOn}
                onCheckedChange={handleToggle}
                disabled={!ready}
                aria-label="Toggle analytics"
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px]">
            <Link
              href={"/privacy" as Route}
              target="_blank"
              className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider text-white/45 transition-colors hover:text-white/80"
            >
              Privacy policy <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              href={"/terms" as Route}
              target="_blank"
              className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider text-white/45 transition-colors hover:text-white/80"
            >
              Terms of service <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </SettingsSectionBody>
      </SettingsSection>
    </div>
  );
}

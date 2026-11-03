"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useConsent } from "@/hooks/use-consent";
import { setConsent } from "@/lib/consent";
import { ANALYTICS_ENABLED } from "@/lib/analytics";
import { toast } from "sonner";
import { SettingsGroup } from "./settings-page";

function handleToggle(next: boolean) {
  setConsent({ analytics: next ? "granted" : "denied" });
  toast.success(next ? "Analytics enabled" : "Analytics disabled");
}

export function PrivacySection() {
  const { consent, ready } = useConsent();
  const analyticsOn = consent.analytics === "granted";

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Analytics"
        description="Help us improve GitTerm by sharing anonymous product usage. You can change this any time."
      >
        {!ANALYTICS_ENABLED ? (
          <p className="border-t border-line pt-4 text-[14px] text-fg-3">
            Analytics is not configured on this deployment. Nothing is being collected.
          </p>
        ) : (
          <div className="flex items-start justify-between gap-6 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-fg">Share anonymous usage data</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-fg-3">
                Page views and feature events. No content from your workspaces, no selling of data,
                no advertising.
              </p>
            </div>
            <Switch
              checked={analyticsOn}
              onCheckedChange={handleToggle}
              disabled={!ready}
              aria-label="Toggle analytics"
              className="mt-0.5"
            />
          </div>
        )}
      </SettingsGroup>

      <div className="flex flex-wrap items-center gap-5 text-[13.5px]">
        <Link
          href={"/privacy" as Route}
          target="_blank"
          className="inline-flex items-center gap-1 text-fg-3 transition-colors hover:text-fg"
        >
          Privacy policy <ArrowUpRight className="size-3.5" />
        </Link>
        <Link
          href={"/terms" as Route}
          target="_blank"
          className="inline-flex items-center gap-1 text-fg-3 transition-colors hover:text-fg"
        >
          Terms of service <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

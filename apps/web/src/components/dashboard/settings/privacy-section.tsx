"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useConsent } from "@/hooks/use-consent";
import { setConsent } from "@/lib/consent";
import { ANALYTICS_ENABLED } from "@/lib/analytics";
import { toast } from "sonner";
import { Panel, PanelRow, SectionHeading, StatusDot } from "@/components/dashboard/kit";

function handleToggle(next: boolean) {
  setConsent({ analytics: next ? "granted" : "denied" });
  toast.success(next ? "Analytics enabled" : "Analytics disabled");
}

const LEGAL = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of service" },
];

export function PrivacySection() {
  const { consent, ready } = useConsent();
  const analyticsOn = consent.analytics === "granted";

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <SectionHeading
          title="Analytics"
          description="Anonymous product usage helps us improve GitTerm. Change it any time."
        />
        <Panel>
          {!ANALYTICS_ENABLED ? (
            <PanelRow className="flex-wrap gap-y-2 py-4">
              <p className="min-w-0 flex-1 text-[14px] text-fg-2">
                Analytics isn&apos;t configured on this deployment.
              </p>
              <StatusDot tone="muted">Nothing collected</StatusDot>
            </PanelRow>
          ) : (
            <PanelRow className="items-start gap-4 py-4">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="analytics-consent"
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] font-medium text-fg"
                >
                  Share anonymous usage data
                  {ready ? (
                    <StatusDot tone={analyticsOn ? "ok" : "muted"}>
                      {analyticsOn ? "On" : "Off"}
                    </StatusDot>
                  ) : null}
                </label>
                <p className="mt-1 text-[13.5px] leading-relaxed text-fg-3">
                  Page views and feature events. No content from your workspaces, no selling of
                  data, no advertising.
                </p>
              </div>
              <Switch
                id="analytics-consent"
                checked={analyticsOn}
                onCheckedChange={handleToggle}
                disabled={!ready}
                className="mt-0.5"
              />
            </PanelRow>
          )}
        </Panel>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Policies" />
        <Panel>
          {LEGAL.map((link) => (
            <Link
              key={link.href}
              href={link.href as Route}
              target="_blank"
              className="group flex items-center justify-between gap-3 px-4 py-3.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg sm:px-5"
            >
              {link.label}
              <ArrowUpRight className="size-4 text-fg-4 transition-colors group-hover:text-fg" />
            </Link>
          ))}
        </Panel>
      </section>
    </div>
  );
}

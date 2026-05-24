"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FormCard,
  FormCardBody,
  FormCardFooter,
  FormCardHeader,
  FormCardStatus,
} from "@/components/ui/form-card";
import {
  initiateCheckout,
  openCustomerPortal,
  isBillingEnabled,
  authClient,
} from "@/lib/auth-client";
import {
  ArrowRight,
  Check,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  Server,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { track } from "@/lib/analytics";

type UserPlan = "free" | "pro";

interface BillingSectionProps {
  currentPlan: UserPlan;
}

interface QuotaRow {
  label: string;
  icon: typeof Clock;
  free: string | boolean;
  pro: string | boolean;
}

const QUOTAS: QuotaRow[] = [
  {
    label: "Cloud runtime",
    icon: Clock,
    free: "60 min / day",
    pro: "Unlimited",
  },
  {
    label: "Workspaces",
    icon: Server,
    free: "5 max",
    pro: "15 max",
  },
  {
    label: "Custom subdomains",
    icon: Globe,
    free: false,
    pro: true,
  },
];

function QuotaValue({ value, dim = false }: { value: string | boolean; dim?: boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-emerald-400" />
    ) : (
      <X className={`h-4 w-4 ${dim ? "text-white/25" : "text-white/40"}`} />
    );
  }
  return (
    <span
      className={`font-mono text-[12.5px] tabular-nums ${dim ? "text-white/40" : "text-white/85"}`}
    >
      {value}
    </span>
  );
}

export function BillingSection({ currentPlan }: BillingSectionProps) {
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const { data: session } = authClient.useSession();

  if (!isBillingEnabled) {
    return (
      <FormCard>
        <FormCardHeader>
          <span>Plan</span>
          <FormCardStatus tone="muted">self-hosted</FormCardStatus>
        </FormCardHeader>
        <FormCardBody>
          <h3 className="text-lg font-semibold tracking-tight text-white">
            All features unlocked.
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
            You're running GitTerm on your own infrastructure - no quotas, no plans, no Polar. Bring
            as many keys, workspaces, and subdomains as your cluster can handle.
          </p>
        </FormCardBody>
      </FormCard>
    );
  }

  const handleOpenPortal = async () => {
    track("customer_portal_opened");
    setIsPortalLoading(true);
    try {
      await openCustomerPortal();
    } catch (error) {
      console.error("Failed to open customer portal:", error);
    } finally {
      setIsPortalLoading(false);
    }
  };

  const handleUpgrade = async () => {
    if (isCheckoutLoading) return;
    track("upgrade_initiated", { plan: "pro", source: "settings_account" });
    setIsCheckoutLoading(true);
    try {
      await initiateCheckout("pro");
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  if (currentPlan === "pro") {
    return (
      <FormCard tone="success">
        <FormCardHeader>
          <span>Plan</span>
          <FormCardStatus tone="ready">pro · active</FormCardStatus>
        </FormCardHeader>

        <FormCardBody className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-white">$20</span>
                <span className="text-sm text-white/35">/ month</span>
              </div>
              <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/45">
                Unlimited cloud runtime, 3× more workspaces, and custom subdomains. Your AI spending
                stays with your provider - we never mark it up.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPortal}
              disabled={isPortalLoading}
              className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              {isPortalLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Settings className="h-3.5 w-3.5" />
              )}
              Manage
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>

          <div className="grid gap-1.5">
            {QUOTAS.map((row) => {
              const Icon = row.icon;
              return (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-lg bg-input/60 px-3.5 py-2.5"
                >
                  <span className="flex items-center gap-2.5 text-[13px] text-white/65">
                    <Icon className="h-3.5 w-3.5 text-white/35" />
                    {row.label}
                  </span>
                  <QuotaValue value={row.pro} />
                </div>
              );
            })}
          </div>
        </FormCardBody>

        <FormCardFooter>
          <span className="truncate">billed monthly · cancel any time in the portal</span>
          {session?.user?.email && (
            <span className="hidden shrink-0 sm:inline">{session.user.email}</span>
          )}
        </FormCardFooter>
      </FormCard>
    );
  }

  return (
    <FormCard>
      <FormCardHeader>
        <span>Plan</span>
        <FormCardStatus tone="muted">free</FormCardStatus>
      </FormCardHeader>

      <FormCardBody className="space-y-7">
        <div>
          <h3 className="text-xl font-semibold leading-tight tracking-tight text-white">
            We just <span className="italic text-[color:var(--cream)]">run</span> the workspaces.
          </h3>
          <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-white/50">
            Bring your own AI keys. We don't mark them up. Pro pays for the workspace itself -
            unlimited cloud time, 3× more workspaces, and custom subdomains.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl bg-input/40">
          <div className="grid grid-cols-[1fr_96px_96px] items-center gap-4 border-b border-white/[0.04] bg-white/[0.015] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            <span />
            <span className="text-center">Free</span>
            <span className="text-center text-primary/80">Pro</span>
          </div>
          {QUOTAS.map((row, idx) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className={`grid grid-cols-[1fr_96px_96px] items-center gap-4 px-4 py-3 ${
                  idx < QUOTAS.length - 1 ? "border-b border-white/[0.03]" : ""
                }`}
              >
                <span className="flex items-center gap-2.5 text-[13.5px] text-white/75">
                  <Icon className="h-3.5 w-3.5 text-white/35" />
                  {row.label}
                </span>
                <span className="flex justify-center">
                  <QuotaValue value={row.free} dim />
                </span>
                <span className="flex justify-center">
                  <QuotaValue value={row.pro} />
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            disabled={isCheckoutLoading}
            onClick={handleUpgrade}
            className="group font-mono text-[12px] font-bold uppercase tracking-[0.18em]"
          >
            {isCheckoutLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isCheckoutLoading ? "Redirecting…" : "Upgrade to Pro"}
          </Button>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">
            $20 / month · cancel any time
          </span>
        </div>
      </FormCardBody>

      <FormCardFooter>
        <span className="truncate">questions about Pro?</span>
        <Link
          href={"/pricing" as Route}
          className="inline-flex shrink-0 items-center gap-1.5 text-white/55 hover:text-white"
        >
          compare all plans
          <ArrowRight className="h-3 w-3" />
        </Link>
      </FormCardFooter>
    </FormCard>
  );
}

/**
 * Plan badge for display in navigation/header
 */
export function PlanBadge({ plan }: { plan: UserPlan }) {
  if (!isBillingEnabled || plan === "free") {
    return null;
  }

  return (
    <Badge
      variant="default"
      className="capitalize text-xs border-primary/30 bg-primary/10 text-primary"
    >
      {plan}
    </Badge>
  );
}

/**
 * Simple upgrade prompt component for use throughout the app
 */
export function UpgradePrompt({
  message = "Unlock more features",
  size = "default",
}: {
  message?: string;
  size?: "default" | "compact";
}) {
  if (!isBillingEnabled) {
    return null;
  }

  if (size === "compact") {
    return (
      <Link
        href={"/pricing" as Route}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Sparkles className="h-3 w-3" />
        {message}
      </Link>
    );
  }

  return (
    <Link href={"/pricing" as Route}>
      <Button variant="outline" size="sm" className="gap-2">
        <Sparkles className="h-4 w-4" />
        {message}
      </Button>
    </Link>
  );
}

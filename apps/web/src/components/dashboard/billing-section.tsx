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

type UserPlan = "free" | "starter" | "pro";
type PaidPlan = "starter" | "pro";

interface BillingSectionProps {
  currentPlan: UserPlan;
}

const PLAN_PRICE: Record<PaidPlan, number> = {
  starter: 10,
  pro: 25,
};

interface QuotaRow {
  label: string;
  icon: typeof Clock;
  free: string | boolean;
  starter: string | boolean;
  pro: string | boolean;
}

const QUOTAS: QuotaRow[] = [
  {
    label: "Cloud runtime",
    icon: Clock,
    free: "60 min / day",
    starter: "180 min / day",
    pro: "480 min / day",
  },
  {
    label: "Agent runs",
    icon: Sparkles,
    free: "10 / mo",
    starter: "75 / mo",
    pro: "250 / mo",
  },
  {
    label: "Workspaces",
    icon: Server,
    free: "2 max",
    starter: "5 max",
    pro: "15 max",
  },
  {
    label: "Idle workspace retention",
    icon: Clock,
    free: "2 days",
    starter: "7 days",
    pro: "15 days",
  },
  {
    label: "Providers",
    icon: Globe,
    free: "E2B only",
    starter: "All",
    pro: "All",
  },
  {
    label: "Persistent workspaces",
    icon: Server,
    free: false,
    starter: true,
    pro: true,
  },
  {
    label: "Custom subdomains",
    icon: Globe,
    free: false,
    starter: true,
    pro: true,
  },
];

function QuotaValue({
  value,
  dim = false,
}: {
  value: string | boolean;
  dim?: boolean;
}) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-emerald-400" />
    ) : (
      <X className={`h-4 w-4 ${dim ? "text-white/25" : "text-white/40"}`} />
    );
  }
  return (
    <span
      className={`font-mono text-[11px] leading-tight tabular-nums sm:whitespace-nowrap sm:text-[12px] ${dim ? "text-white/40" : "text-white/85"}`}
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
            You're running GitTerm on your own infrastructure - no quotas, no
            plans, no Polar. Bring as many keys, workspaces, and subdomains as
            your cluster can handle.
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

  const handleUpgrade = async (slug: PaidPlan) => {
    if (isCheckoutLoading) return;
    track("upgrade_initiated", { plan: slug, source: "settings_account" });
    setIsCheckoutLoading(true);
    try {
      await initiateCheckout(slug);
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  // Active paid plan (starter or pro): show the plan's quotas + manage button,
  // plus an upgrade-to-Pro nudge for Starter customers.
  if (currentPlan === "starter" || currentPlan === "pro") {
    const planQuotaValue = (row: QuotaRow) =>
      currentPlan === "pro" ? row.pro : row.starter;

    return (
      <FormCard tone="success">
        <FormCardHeader>
          <span>Plan</span>
          <FormCardStatus tone="ready">{currentPlan} · active</FormCardStatus>
        </FormCardHeader>

        <FormCardBody className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-white">
                  ${PLAN_PRICE[currentPlan]}
                </span>
                <span className="text-sm text-white/35">/ month</span>
              </div>
              <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/45">
                {currentPlan === "pro"
                  ? "480 minutes/day, all providers, persistence, and custom subdomains. Your AI spending stays with your provider, we never mark it up."
                  : "180 minutes/day, every provider, and persistent workspaces. Your AI spending stays with your provider, we never mark it up."}
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
                  <QuotaValue value={planQuotaValue(row)} />
                </div>
              );
            })}
          </div>

          {currentPlan === "starter" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">
                Need more? Pro is $25 / month
              </span>
              <Button
                type="button"
                size="sm"
                disabled={isCheckoutLoading}
                onClick={() => handleUpgrade("pro")}
                className="group gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
              >
                {isCheckoutLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Upgrade to Pro
              </Button>
            </div>
          )}
        </FormCardBody>

        <FormCardFooter>
          <span className="truncate">
            billed monthly · cancel any time in the portal
          </span>
          {session?.user?.email && (
            <span className="hidden shrink-0 sm:inline">
              {session.user.email}
            </span>
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
            We just <span className="italic text-(--cream)">run</span> the
            workspaces.
          </h3>
          <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-white/50">
            Bring your own AI keys. We don't mark them up. Free runs on E2B
            sandboxes - upgrade to unlock every provider, persistent workspaces,
            and more runtime.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/[0.05] bg-input/40">
          <div className="grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] items-center border-b border-white/[0.06] bg-white/[0.015] font-mono text-[9px] uppercase tracking-[0.08em] text-white/35 sm:text-[10px] sm:tracking-[0.18em]">
            <span className="px-3 py-2.5 sm:px-4" />
            <span className="px-1.5 py-2.5 text-center sm:px-3">Free</span>
            <span className="px-1.5 py-2.5 text-center text-primary/80 sm:px-3">
              Starter
            </span>
            <span className="px-1.5 py-2.5 text-center text-primary/80 sm:px-3">
              Pro
            </span>
          </div>
          {QUOTAS.map((row, idx) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className={`grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] items-center ${
                  idx % 2 === 1 ? "bg-white/[0.012]" : ""
                } ${
                  idx < QUOTAS.length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
              >
                <span className="flex items-center gap-2 px-3 py-3 text-[12px] text-white/75 sm:gap-2.5 sm:px-4 sm:text-[13px]">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-white/35" />
                  {row.label}
                </span>
                <span className="flex justify-center px-1.5 py-3 text-center sm:px-3">
                  <QuotaValue value={row.free} dim />
                </span>
                <span className="flex justify-center px-1.5 py-3 text-center sm:px-3">
                  <QuotaValue value={row.starter} />
                </span>
                <span className="flex justify-center px-1.5 py-3 text-center sm:px-3">
                  <QuotaValue value={row.pro} />
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            asChild
            type="button"
            className="group font-mono text-[12px] font-bold uppercase tracking-[0.18em]"
          >
            <Link href={"/pricing" as Route}>
              <Sparkles className="h-3.5 w-3.5" />
              Upgrade
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </div>
      </FormCardBody>

      <FormCardFooter>
        <a href="/pricing#questions" className="truncate">
          questions about plans?
        </a>
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
export function PlanBadge({ plan }: { plan: UserPlan | string }) {
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

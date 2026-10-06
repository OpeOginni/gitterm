"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { initiateCheckout, openCustomerPortal, isBillingEnabled } from "@/lib/auth-client";
import { ArrowRight, ExternalLink, Loader2, Sparkles } from "lucide-react";
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

const PLAN_LINE: Record<PaidPlan, string> = {
  starter: "Every provider and machine size, persistent workspaces, 180 minutes a day.",
  pro: "Every provider and machine size, custom subdomains, 480 minutes a day.",
};

/** One plan row in the workspace-card style: what you are on, and where to change it. */
function PlanRow({
  name,
  detail,
  action,
}: {
  name: React.ReactNode;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fill">
        <Sparkles className="size-4 text-primary opacity-80" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{name}</p>
        <p className="mt-0.5 text-xs text-fg-4">{detail}</p>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function BillingSection({ currentPlan }: BillingSectionProps) {
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  if (!isBillingEnabled) {
    return <PlanRow name="Self-hosted" detail="All features unlocked; no quotas or plans." />;
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
    track("upgrade_initiated", { plan: slug, source: "settings_billing" });
    setIsCheckoutLoading(true);
    try {
      await initiateCheckout(slug);
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  if (currentPlan === "starter" || currentPlan === "pro") {
    return (
      <PlanRow
        name={
          <>
            <span className="capitalize">{currentPlan}</span>
            <span className="ml-2 font-normal text-fg-3">${PLAN_PRICE[currentPlan]} / month</span>
          </>
        }
        detail={PLAN_LINE[currentPlan]}
        action={
          <>
            {currentPlan === "starter" ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-primary"
                disabled={isCheckoutLoading}
                onClick={() => handleUpgrade("pro")}
              >
                Upgrade to Pro
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-line text-xs"
              onClick={handleOpenPortal}
              disabled={isPortalLoading}
            >
              {isPortalLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Manage
              <ExternalLink className="size-3" />
            </Button>
          </>
        }
      />
    );
  }

  return (
    <PlanRow
      name="Free"
      detail="Small E2B or boat sandboxes and 60 minutes a day. Upgrade for every provider, larger machines, and persistence."
      action={
        <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
          <Link href={"/pricing" as Route}>
            Upgrade
            <ArrowRight className="size-3" />
          </Link>
        </Button>
      }
    />
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

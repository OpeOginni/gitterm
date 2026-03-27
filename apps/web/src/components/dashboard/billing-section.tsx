"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  initiateCheckout,
  openCustomerPortal,
  isBillingEnabled,
  authClient,
} from "@/lib/auth-client";
import {
  Check,
  ExternalLink,
  Loader2,
  Sparkles,
  ArrowRight,
  Settings,
  Clock,
  Globe,
  X,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

type UserPlan = "free" | "pro";

interface BillingSectionProps {
  currentPlan: UserPlan;
}

const limits = [
  {
    label: "Cloud runtime",
    free: "60 min / day",
    pro: "Unlimited",
    icon: Clock,
  },
  {
    label: "Custom subdomains",
    free: false,
    pro: true,
    icon: Globe,
  },
];

export function BillingSection({ currentPlan }: BillingSectionProps) {
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const { data: session } = authClient.useSession();

  if (!isBillingEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Billing is not enabled. You have full access to all features in self-hosted mode.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleOpenPortal = async () => {
    setIsPortalLoading(true);
    try {
      await openCustomerPortal();
    } catch (error) {
      console.error("Failed to open customer portal:", error);
    } finally {
      setIsPortalLoading(false);
    }
  };

  // ── Pro subscriber view ──────────────────────────────────────────
  if (currentPlan === "pro") {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  Pro Plan
                  <Badge variant="default" className="text-[10px] uppercase tracking-wider">
                    Active
                  </Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">$20 / month</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPortal}
              disabled={isPortalLoading}
              className="gap-2 border-border/50"
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
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {limits.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-md bg-secondary/20 px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </div>
                <span className="text-sm font-medium">
                  {typeof item.pro === "boolean" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    item.pro
                  )}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Free user view ───────────────────────────────────────────────
  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Your Plan</CardTitle>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
              Free
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Comparison rows */}
        <div className="overflow-hidden rounded-lg border border-border/50">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border/50 bg-secondary/30 px-4 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground" />
            <span className="w-24 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Free
            </span>
            <span className="w-24 text-center text-xs font-medium uppercase tracking-wide text-primary">
              Pro
            </span>
          </div>

          {limits.map((item, idx) => (
            <div
              key={item.label}
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 ${
                idx < limits.length - 1 ? "border-b border-border/30" : ""
              }`}
            >
              <div className="flex items-center gap-2.5 text-sm">
                <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                {item.label}
              </div>
              <span className="w-24 text-center text-sm text-muted-foreground">
                {typeof item.free === "boolean" ? (
                  item.free ? (
                    <Check className="mx-auto h-4 w-4 text-green-500" />
                  ) : (
                    <X className="mx-auto h-4 w-4 text-muted-foreground/40" />
                  )
                ) : (
                  item.free
                )}
              </span>
              <span className="w-24 text-center text-sm font-medium">
                {typeof item.pro === "boolean" ? (
                  <Check className="mx-auto h-4 w-4 text-green-500" />
                ) : (
                  item.pro
                )}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Upgrade to Pro</p>
          </div>
          <Link href={"/pricing" as Route}>
            <Button size="sm" className="gap-2">
              View Pricing
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
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

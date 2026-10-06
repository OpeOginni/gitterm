"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { initiateCheckout, openCustomerPortal, isBillingEnabled } from "@/lib/auth-client";
import { ArrowRight, ExternalLink, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { track } from "@/lib/analytics";
import { useBillingAccount } from "@/lib/billing";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

type CheckoutPlan = "pro" | "growth";

/** Used to suggest Growth when Pro plus pay-as-you-go would cost more. */
const GROWTH_PRICE_CENTS = 20000;
const GROWTH_INCLUDED_CENTS = 25000;
const PRO_PRICE_CENTS = 2500;
const PRO_INCLUDED_CENTS = 2500;

const dollars = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 && cents >= 1000 ? 0 : 2)}`;

/** One plan row in the workspace-card style: what you are on, and where to change it. */
function PlanRow({
  name,
  detail,
  action,
}: {
  name: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fill">
        <Sparkles className="size-4 text-primary opacity-80" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{name}</p>
        {detail ? <p className="mt-0.5 text-xs text-fg-4">{detail}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function BillingSection() {
  const { data } = useBillingAccount();
  const account = data?.account ?? null;
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

  const handleUpgrade = async (slug: CheckoutPlan) => {
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

  if (account?.compute) {
    return (
      <div className="space-y-3">
        <PlanRow
          name={
            <>
              {account.planName}
              <span className="ml-2 font-normal text-fg-3">
                {dollars(account.priceCents)} / month
              </span>
            </>
          }
          action={
            <>
              {account.plan !== "growth" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-primary"
                  disabled={isCheckoutLoading}
                  onClick={() => handleUpgrade("growth")}
                >
                  Upgrade to Growth
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
        <PayAsYouGoSettings compute={account.compute} />
      </div>
    );
  }

  return (
    <PlanRow
      name="Free"
      detail="Small E2B or boat sandboxes and 60 minutes a day. Upgrade for every provider and machine size, always-on workspaces, and a monthly compute balance."
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

type ComputeUsage = NonNullable<
  NonNullable<ReturnType<typeof useBillingAccount>["data"]>["account"]
>["compute"] &
  object;

function UsageBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-fill-2">
      <div
        className={`h-full rounded-full ${percent >= 100 ? "bg-destructive" : percent >= 75 ? "bg-amber-500" : "bg-primary"}`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

/** Paid plans: included compute and pay-as-you-go spend this period, with an upgrade hint. */
export function ComputeUsageCard() {
  const { data } = useBillingAccount();
  const account = data?.account;
  const compute = account?.compute;
  if (!account || !compute) return null;

  const resets = new Date(account.period.end).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const proBill = PRO_PRICE_CENTS + Math.max(0, compute.projectedCents - PRO_INCLUDED_CENTS);
  const recommendGrowth = account.plan === "pro" && proBill > GROWTH_PRICE_CENTS;

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card px-5 py-4">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-fg">Included compute</p>
          <p className="font-mono text-[12px] tabular-nums text-fg-3">
            {dollars(compute.usedCents)} of {dollars(compute.includedCents)} · resets {resets}
          </p>
        </div>
        <UsageBar percent={(compute.usedCents / Math.max(compute.includedCents, 1)) * 100} />
        {compute.runningCentsPerHour > 0 ? (
          <p className="text-xs text-fg-4">
            Running workspaces cost {dollars(compute.runningCentsPerHour)}/hour right now.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <div className={`space-y-3 ${compute.payAsYouGo ? "" : "opacity-50"}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-fg">
              Pay-as-you-go
              {compute.payAsYouGo ? (
                compute.overageDiscountPercent ? (
                  <span className="ml-2 font-normal text-fg-4">
                    {compute.overageDiscountPercent}% off
                  </span>
                ) : null
              ) : (
                <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-fg-4">
                  Off
                </span>
              )}
            </p>
            <p className="font-mono text-[12px] tabular-nums text-fg-3">
              {dollars(compute.overageCents)}
              {compute.spendCapCents !== null ? ` of ${dollars(compute.spendCapCents)} limit` : ""}
            </p>
          </div>
          {compute.payAsYouGo && compute.spendCapCents !== null ? (
            <UsageBar percent={(compute.overageCents / Math.max(compute.spendCapCents, 1)) * 100} />
          ) : (
            <div className="h-2 rounded-full bg-fill-2" />
          )}
        </div>
        {compute.payAsYouGo ? null : (
          <p className="text-xs text-fg-4">
            Workspaces pause when the included compute runs out.{" "}
            <Link href={"#billing" as Route} className="text-primary hover:underline">
              Turn on pay-as-you-go
            </Link>{" "}
            to keep them running.
          </p>
        )}
      </div>

      {recommendGrowth ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3">
          <p className="min-w-0 flex-1 text-xs text-fg-2">
            At your current pace you&apos;ll use about {dollars(compute.projectedCents)} of compute
            this period: about {dollars(proBill)} on Pro. Growth covers up to{" "}
            {dollars(GROWTH_INCLUDED_CENTS)} for {dollars(GROWTH_PRICE_CENTS)}.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              track("upgrade_initiated", { plan: "growth", source: "settings_usage" });
              void initiateCheckout("growth");
            }}
          >
            Switch to Growth
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Whether to keep running past the included compute, and up to what limit. */
function PayAsYouGoSettings({ compute }: { compute: ComputeUsage }) {
  const queryClient = useQueryClient();
  const [payAsYouGo, setPayAsYouGo] = useState(compute.payAsYouGo);
  const [capDollars, setCapDollars] = useState(
    compute.spendCapCents === null ? "50" : String(compute.spendCapCents / 100),
  );
  const saveSettings = useMutation(
    trpc.billing.updateSettings.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.billing.account.queryKey() });
        toast.success("Billing settings saved");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const capCents = Math.round(Number(capDollars) * 100);
  const dirty =
    payAsYouGo !== compute.payAsYouGo || (payAsYouGo && capCents !== (compute.spendCapCents ?? 0));

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <Switch checked={payAsYouGo} onCheckedChange={setPayAsYouGo} />
          Keep running past the included compute
        </label>
        {payAsYouGo ? (
          <label className="flex items-center gap-1.5 text-xs text-fg-3">
            up to $
            <Input
              type="number"
              min={1}
              className="h-8 w-24"
              value={capDollars}
              onChange={(event) => setCapDollars(event.target.value)}
            />
            per period
          </label>
        ) : null}
        <Button
          size="sm"
          className="ml-auto h-8 text-xs"
          disabled={!dirty || saveSettings.isPending}
          onClick={() =>
            saveSettings.mutate({ payAsYouGo, spendCapCents: payAsYouGo ? capCents : null })
          }
        >
          Save
        </Button>
      </div>
      <p className="text-xs text-fg-4">
        {payAsYouGo
          ? "Extra compute is billed at each size's hourly price. Workspaces pause when your limit is reached."
          : "Workspaces pause when the included compute runs out. Your work is kept."}
      </p>
    </div>
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

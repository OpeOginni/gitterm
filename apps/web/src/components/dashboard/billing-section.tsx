"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { initiateCheckout, openCustomerPortal, isBillingEnabled } from "@/lib/auth-client";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { track } from "@/lib/analytics";
import { useBillingAccount } from "@/lib/billing";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";
import { SettingsSaveBar } from "@/components/dashboard/settings/settings-page";
import { Panel, PanelRow, StatusDot } from "@/components/dashboard/kit";
import { Skeleton } from "@/components/ui/skeleton";

type CheckoutPlan = "pro" | "growth";

export const dollars = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 && cents >= 1000 ? 0 : 2)}`;

/** The plan as the panel's first row: what you are on, and where to change it. */
function PlanRow({
  name,
  price,
  detail,
  action,
}: {
  name: string;
  price?: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <PanelRow className="flex-wrap gap-y-3 py-4">
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="font-display text-[19px] font-semibold tracking-[-0.02em] text-fg">
            {name}
          </span>
          {price ? <span className="text-[13.5px] text-fg-3 tabular-nums">{price}</span> : null}
        </p>
        {detail ? (
          <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-fg-3">{detail}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </PanelRow>
  );
}

/** Shaped like the paid plan panel: the plan row, then pay-as-you-go. */
function BillingSkeleton() {
  return (
    <Panel>
      <PanelRow className="py-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-36 bg-fill-2" />
          <Skeleton className="h-4 w-64 max-w-full bg-fill-2" />
        </div>
        <Skeleton className="h-9 w-24 shrink-0 rounded-lg bg-fill-2" />
      </PanelRow>
      <PanelRow className="items-start gap-4 py-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-32 bg-fill-2" />
          <Skeleton className="h-4 w-96 max-w-full bg-fill-2" />
        </div>
        <Skeleton className="mt-0.5 h-5 w-9 shrink-0 rounded-full bg-fill-2" />
      </PanelRow>
    </Panel>
  );
}

export function BillingSection() {
  const { data, isPending } = useBillingAccount();
  const account = data?.account ?? null;
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  if (!isBillingEnabled) {
    return (
      <Panel>
        <PlanRow name="Self-hosted" detail="Every feature unlocked. No quotas or plans." />
      </Panel>
    );
  }

  // Not "Free" before the account loads: that would flash the wrong plan.
  if (isPending) return <BillingSkeleton />;

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

  const handleUpgrade = async (slug: CheckoutPlan) => {
    if (isCheckoutLoading) return;
    track("checkout_started", { plan: slug, source: "settings_billing" });
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
      <PayAsYouGoSettings compute={account.compute}>
        <PlanRow
          name={account.planName}
          price={`${dollars(account.priceCents)} a month`}
          detail={`Includes ${dollars(account.compute.includedCents)} of compute each period.`}
          action={
            <>
              {account.plan !== "growth" ? (
                <Button
                  variant="ghost"
                  disabled={isCheckoutLoading}
                  onClick={() => handleUpgrade("growth")}
                  className="text-primary hover:text-primary"
                >
                  Upgrade to Growth
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className="gap-1.5"
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
      </PayAsYouGoSettings>
    );
  }

  return (
    <Panel>
      <PlanRow
        name="Free"
        detail="Small E2B or Boat sandboxes and 60 minutes a day. Upgrade for every provider and machine size, always-on workspaces, sandbox snapshots, and a monthly compute balance."
        action={
          <Button asChild className="gap-1.5">
            <Link href={"/pricing" as Route}>
              Upgrade
              <ArrowRight className="size-3" />
            </Link>
          </Button>
        }
      />
    </Panel>
  );
}

export type ComputeUsage = NonNullable<
  NonNullable<NonNullable<ReturnType<typeof useBillingAccount>["data"]>["account"]>["compute"]
>;

/**
 * Whether to keep running past the included compute, and up to what limit, below the plan row
 * (`children`). The save bar sits outside the panel so it can stick to the viewport.
 */
function PayAsYouGoSettings({
  compute,
  children,
}: {
  compute: ComputeUsage;
  children: React.ReactNode;
}) {
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

  const reset = () => {
    setPayAsYouGo(compute.payAsYouGo);
    setCapDollars(compute.spendCapCents === null ? "50" : String(compute.spendCapCents / 100));
  };

  return (
    <>
      <Panel>
        {children}
        <PanelRow className="items-start gap-4 py-4">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="pay-as-you-go"
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] font-medium text-fg"
            >
              Pay-as-you-go
              <StatusDot tone={compute.payAsYouGo ? "ok" : "muted"}>
                {compute.payAsYouGo ? "On" : "Off"}
              </StatusDot>
            </label>
            <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-fg-3">
              {payAsYouGo
                ? `Keep running past the included compute, billed at each size's hourly price${compute.overageDiscountPercent ? ` less ${compute.overageDiscountPercent}%` : ""}. Workspaces pause at your limit.`
                : "Workspaces pause when the included compute runs out. Your work is kept."}
            </p>
          </div>
          <Switch
            id="pay-as-you-go"
            checked={payAsYouGo}
            onCheckedChange={setPayAsYouGo}
            className="mt-0.5"
          />
        </PanelRow>
        {payAsYouGo ? (
          <PanelRow className="flex-wrap gap-y-2">
            <label htmlFor="spend-limit" className="flex-1 text-[14px] text-fg-2">
              Spend limit per period
            </label>
            <span className="flex items-center gap-2 text-[14px] text-fg-3">
              $
              <Input
                id="spend-limit"
                type="number"
                min={1}
                className="h-9 w-24 tabular-nums"
                value={capDollars}
                onChange={(event) => setCapDollars(event.target.value)}
              />
            </span>
          </PanelRow>
        ) : null}
      </Panel>
      <SettingsSaveBar
        visible={dirty}
        saving={saveSettings.isPending}
        onCancel={reset}
        onSave={() =>
          saveSettings.mutate({ payAsYouGo, spendCapCents: payAsYouGo ? capCents : null })
        }
      />
    </>
  );
}

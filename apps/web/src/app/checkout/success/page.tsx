"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useCurrentPlan } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { track, useAnalyticsReady } from "@/lib/analytics";
import { SiteShell } from "@/components/site/site-shell";

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const { isPending } = authClient.useSession();
  const currentPlan = useCurrentPlan();
  const [showPing, setShowPing] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const analyticsReady = useAnalyticsReady();
  const trackedReturn = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowPing(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedPlan = sessionStorage.getItem("checkout_plan");
      if (storedPlan) {
        setCheckoutPlan(storedPlan);
        sessionStorage.removeItem("checkout_plan");
      }
    }
  }, []);

  useEffect(() => {
    if (!analyticsReady || trackedReturn.current || !checkoutId) return;
    if (checkoutPlan !== "pro" && checkoutPlan !== "growth") return;
    trackedReturn.current = true;
    // This is a browser return, not proof of a paid subscription. Revenue belongs to webhooks.
    track("checkout_returned", { plan: checkoutPlan });
  }, [analyticsReady, checkoutId, checkoutPlan]);

  const userPlan = checkoutPlan || currentPlan;
  const planName = userPlan.charAt(0).toUpperCase() + userPlan.slice(1);
  const isPaidPlan = userPlan !== "free";

  return (
    <SiteShell footer={false}>
      <div className="flex min-h-[calc(100svh-65px)] flex-col items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full max-w-[26rem]">
          <div className="relative mx-auto size-14">
            {showPing && (
              <div className="absolute inset-0 rounded-full bg-primary/20 motion-safe:animate-ping motion-reduce:hidden" />
            )}
            <div className="relative flex size-14 items-center justify-center rounded-full bg-primary/12">
              <Check className="size-6 text-[#e2c47c]" />
            </div>
          </div>

          <div className="mt-7 text-center">
            <h1 className="m-0 text-[clamp(2rem,4vw,2.5rem)] leading-[1.05] font-display font-semibold tracking-[-0.03em] text-fg">
              Payment successful.
            </h1>
            <p className="mt-3 text-[16px] leading-[1.6] text-fg-3">
              Your account has been upgraded. You're ready to build.
            </p>
          </div>

          <div className="mt-9 border-y border-line py-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[15px] text-fg-3">Your plan</span>
              <span
                className={cn(
                  "text-[15px] font-medium",
                  isPaidPlan ? "text-[#e2c47c]" : "text-fg-2",
                )}
              >
                {isPending && !checkoutPlan ? "..." : planName}
              </span>
            </div>
            {checkoutId && (
              <p className="mt-2 truncate font-mono text-[12.5px] text-fg-4">ID: {checkoutId}</p>
            )}
          </div>

          <div className="mt-7">
            <h2 className="m-0 text-[15px] font-medium text-fg-2">What's next</h2>
            <ul className="mt-3 space-y-2.5">
              {[
                "Your plan benefits are now active",
                ...(userPlan === "pro"
                  ? ["480 min/day runtime + all providers", "Custom subdomains for all workspaces"]
                  : userPlan === "starter"
                    ? ["180 min/day runtime + all providers", "Persistent workspaces unlocked"]
                    : []),
                "Manage your subscription anytime from Settings",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 text-[15px] leading-[1.5] text-fg-3"
                >
                  <Check className="mt-[3px] size-4 shrink-0 text-[#e2c47c]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-9 flex flex-col gap-3">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[14.5px] font-medium text-primary-foreground transition-colors hover:bg-[#c09a45]"
            >
              Go to dashboard
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/dashboard/settings/account#billing"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-white/[0.04] px-4 text-[14.5px] font-medium text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors hover:bg-white/[0.07] hover:text-fg"
            >
              Manage subscription
            </Link>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="dark min-h-screen bg-background" />}>
      <CheckoutSuccessContent />
    </Suspense>
  );
}

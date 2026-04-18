"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Terminal, Check, ArrowRight } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const { data: session, isPending } = authClient.useSession();
  const [showPing, setShowPing] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);

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

  const userPlan = checkoutPlan || (session?.user as any)?.plan || "free";
  const planName = userPlan.charAt(0).toUpperCase() + userPlan.slice(1);

  return (
    <div className="flex min-h-screen flex-col bg-background landing-grid dark">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center px-6">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
              GitTerm
            </span>
          </Link>
        </div>
      </header>

      {/* Center content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-8 text-center">
          {/* Success icon */}
          <div className="relative mx-auto h-20 w-20">
            {showPing && (
              <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            )}
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
              <Check className="h-9 w-9 text-primary" />
            </div>
          </div>

          {/* Message */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Payment successful.</h1>
            <p className="mt-2 text-muted-foreground">
              Your account has been upgraded. You're ready to build.
            </p>
          </div>

          {/* Plan card */}
          <div className="rounded-2xl border border-border bg-card p-5 text-left">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
                Your plan
              </span>
              <span
                className={cn(
                  "rounded-full border px-3 py-0.5 font-mono text-xs font-bold uppercase tracking-wider",
                  userPlan === "pro"
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                {isPending && !checkoutPlan ? "..." : planName}
              </span>
            </div>
            {checkoutId && (
              <div className="mt-4 border-t border-border pt-3">
                <span className="font-mono text-[10px] text-muted-foreground/50">ID: {checkoutId}</span>
              </div>
            )}
          </div>

          {/* What's next */}
          <div className="space-y-3 text-left">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
              What's next
            </p>
            {[
              "Your plan benefits are now active",
              ...(userPlan === "pro"
                ? ["Unlimited cloud runtime is enabled", "Custom subdomains for all workspaces"]
                : []),
              "Manage your subscription anytime from Settings",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {item}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/85"
            >
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-secondary px-6 py-2.5 font-mono text-sm text-secondary-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              Manage Subscription
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}

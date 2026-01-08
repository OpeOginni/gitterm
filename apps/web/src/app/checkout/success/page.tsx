"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Terminal, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const { data: session, isPending } = authClient.useSession();
  const [showConfetti, setShowConfetti] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);

  // Hide confetti after animation
  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Read the plan from sessionStorage (set before checkout redirect)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedPlan = sessionStorage.getItem("checkout_plan");
      if (storedPlan) {
        setCheckoutPlan(storedPlan);
        // Clear it after reading so it doesn't persist on page refresh
        sessionStorage.removeItem("checkout_plan");
      }
    }
  }, []);

  // Use the checkout plan from sessionStorage, falling back to session plan
  const userPlan = checkoutPlan || (session?.user as any)?.plan || "free";
  const planName = userPlan.charAt(0).toUpperCase() + userPlan.slice(1);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <Link href="/" className="flex items-center gap-2">
            <Terminal className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold text-foreground">GitTerm</span>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 text-center">
          {/* Success Icon with animation */}
          <div className="relative">
            {showConfetti && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="absolute h-32 w-32 animate-ping rounded-full bg-green-500/20" />
              </div>
            )}
            <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
            </div>
          </div>

          {/* Success Message */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Payment Successful!
            </h1>
            <p className="text-muted-foreground">
              Thank you for upgrading to GitTerm. Your account has been updated.
            </p>
          </div>

          {/* Plan Details Card */}
          <div className="rounded-lg border border-border bg-card p-6 text-left">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">Your Plan</span>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span
                  className={cn(
                    "font-semibold capitalize",
                    userPlan === "pro" && "text-primary",
                    userPlan === "tunnel" && "text-foreground",
                  )}
                >
                  {isPending && !checkoutPlan ? "Loading..." : planName}
                </span>
              </div>
            </div>

            {checkoutId && (
              <div className="pt-4 border-t border-border">
                <span className="text-xs text-muted-foreground">Checkout ID: {checkoutId}</span>
              </div>
            )}
          </div>

          {/* What's Next Section */}
          <div className="space-y-4 pt-4">
            <h2 className="text-lg font-semibold text-foreground">What&apos;s next?</h2>
            <ul className="space-y-3 text-left">
              <li className="flex items-start gap-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <span>Your plan benefits are now active</span>
              </li>
              {userPlan === "tunnel" && (
                <li className="flex items-start gap-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Create local tunnels with custom subdomains</span>
                </li>
              )}
              {userPlan === "pro" && (
                <>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    <span>Unlimited cloud runtime is enabled</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    <span>Custom subdomains for all workspaces</span>
                  </li>
                </>
              )}
              <li className="flex items-start gap-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <span>Manage your subscription anytime from Settings</span>
              </li>
            </ul>
          </div>

          {/* Action Links */}
          <div className="flex flex-col gap-3 pt-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
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
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}

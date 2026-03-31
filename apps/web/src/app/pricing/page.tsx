"use client";

import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { initiateCheckout, isBillingEnabled, authClient } from "@/lib/auth-client";
import { Check, Terminal, ExternalLink, ArrowRight, Loader2, Globe } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";

type UserPlan = "free" | "pro";

interface PlanTier {
  name: string;
  slug?: "pro";
  price?: number;
  description: string;
  features: string[];
  popular?: boolean;
  exclusive?: boolean;
  isSelfHost?: boolean;
  actionLabel: string;
}

const PLAN_TIERS: PlanTier[] = [
  {
    name: "Free",
    price: 0,
    description: "Perfect for exploring agentic coding and occasional cloud development",
    features: [
      "60 minutes/day cloud runtime",
      "5 workspaces",
      "Auto-generated subdomains",
      "Persistent storage & Git operations",
      "Bring-your-own API keys",
    ],
    actionLabel: "Get Started",
  },
  {
    name: "Pro",
    slug: "pro",
    price: 20,
    description: "Unlimited cloud time, 3x more workspaces, and professional features",
    features: [
      "Unlimited daily cloud runtime",
      "15 workspaces (3x more)",
      "Custom subdomains for branding",
      "Persistent storage & Git operations",
      "Bring-your-own API keys",
    ],
    popular: true,
    actionLabel: "Go Pro",
  },
  {
    name: "Self-Hosted",
    description: "Full control with unlimited everything on your own infrastructure",
    features: [
      "Unlimited cloud runtime & workspaces",
      "Deploy on Railway, AWS, or bare metal",
      "All Pro features unlocked",
      "Bring your own cloud providers",
      "Complete data ownership & privacy",
      "Community-driven open source",
    ],
    exclusive: true,
    isSelfHost: true,
    actionLabel: "Deploy on Railway",
  },
];

/* ─── Feature check item ──────────────────────────────────── */

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span className="text-sm leading-relaxed text-white/50">{text}</span>
    </div>
  );
}

/* ─── Plan card ────────────────────────────────────────────── */

function PricingCard({
  plan,
  currentPlan,
  onUpgrade,
  isLoading,
  loadingPlan,
}: {
  plan: PlanTier;
  currentPlan?: UserPlan;
  onUpgrade: (slug: "pro") => void;
  isLoading: boolean;
  loadingPlan?: "pro" | null;
}) {
  const isCurrentPlan = plan.slug && currentPlan === plan.slug;
  const isFreeCurrentPlan = plan.name === "Free" && currentPlan === "free";
  const isThisPlanLoading = isLoading && loadingPlan === plan.slug;

  return (
    <div
      className={cn(
        "relative flex w-full max-w-[360px] flex-col justify-between rounded-2xl border p-6 transition-colors",
        plan.popular
          ? "border-primary/30 bg-primary/[0.04]"
          : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
      {/* Header */}
      <div>
        <div className="mb-5 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            {plan.name}
          </span>
          {plan.popular && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
              Popular
            </span>
          )}
          {plan.exclusive && (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/40">
              Open Source
            </span>
          )}
        </div>

        {/* Price */}
        <div className="mb-2 flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white">
            {plan.price !== undefined ? `$${plan.price}` : "Free"}
          </span>
          {plan.price !== undefined && plan.price > 0 && (
            <span className="text-sm text-white/30">/month</span>
          )}
        </div>

        <p className="mb-6 min-h-[40px] text-sm leading-relaxed text-white/40">
          {plan.description}
        </p>

        {/* Features */}
        <div className="flex flex-col gap-3">
          {plan.features.map((feature) => (
            <FeatureItem key={feature} text={feature} />
          ))}
        </div>
      </div>

      {/* Action */}
      <div className="mt-8">
        {plan.isSelfHost ? (
          <Link
            href="https://railway.com/template/gitterm?referralCode=o9MFOP"
            target="_blank"
            className="inline-flex w-full items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-6 py-2.5 font-mono text-sm font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            {plan.actionLabel}
            <ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        ) : isCurrentPlan || isFreeCurrentPlan ? (
          <span className="inline-flex w-full items-center justify-center rounded-lg border border-white/[0.06] px-6 py-2.5 font-mono text-sm text-white/30">
            Current Plan
          </span>
        ) : plan.slug ? (
          <button
            onClick={() => onUpgrade(plan.slug!)}
            disabled={isLoading}
            className={cn(
              "inline-flex w-full cursor-pointer items-center justify-center rounded-lg px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-wider transition-all",
              "focus:outline-none focus:ring-2 focus:ring-gold/50 focus:ring-offset-2 focus:ring-offset-[#09090b]",
              "disabled:cursor-not-allowed disabled:opacity-70",
              plan.popular
                ? "bg-primary text-primary-foreground hover:bg-primary/85"
                : "bg-white/90 text-primary-foreground hover:bg-white/80",
            )}
          >
            {isThisPlanLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                {plan.actionLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </button>
        ) : (
          <Link
            href="/dashboard"
            className="inline-flex w-full items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-6 py-2.5 font-mono text-sm font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            {plan.actionLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

/* ─── Page content ─────────────────────────────────────────── */

function PricingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<"pro" | null>(null);
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pricingEnabled = isBillingEnabled;

  useEffect(() => {
    if (!pricingEnabled) {
      router.replace("/");
    }
  }, [pricingEnabled, router]);

  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (planParam && planParam === "pro" && session?.user && !isLoading) {
      const triggerCheckout = async () => {
        setIsLoading(true);
        setLoadingPlan(planParam);
        try {
          await initiateCheckout(planParam);
          router.replace("/pricing");
        } catch (error) {
          console.error("Checkout failed:", error);
          router.replace("/pricing");
        } finally {
          setIsLoading(false);
          setLoadingPlan(null);
        }
      };
      triggerCheckout();
    }
  }, [searchParams, session?.user, router, isLoading]);

  if (!pricingEnabled) {
    return null;
  }

  const currentPlan = ((session?.user as any)?.plan as UserPlan) || "free";

  const handleUpgrade = async (slug: "pro") => {
    if (!isBillingEnabled) {
      window.location.href = "/dashboard";
      return;
    }

    if (!session?.user) {
      const redirectUrl = `/pricing?plan=${slug}`;
      router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    setIsLoading(true);
    setLoadingPlan(slug);
    try {
      await initiateCheckout(slug);
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsLoading(false);
      setLoadingPlan(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#09090b] text-white dark landing-grid">
      <LandingHeader />

      <section className="pt-36 pb-24 md:pt-44 md:pb-32">
        <div className="mx-auto max-w-[1120px] px-6">
          {/* Header */}
          <div className="mb-16 text-center">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
              Pricing
            </p>
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl">
              Simple, transparent pricing.
            </h1>
            <p className="mx-auto max-w-lg text-base text-white/50 sm:text-lg">
              Powerful agentic coding with predictable pricing. No surprise bills.
            </p>
          </div>

          {/* Plan cards */}
          <div className="flex flex-col items-center justify-center gap-5 sm:flex-row sm:items-stretch">
            {PLAN_TIERS.map((plan) => (
              <PricingCard
                key={plan.name}
                plan={plan}
                currentPlan={session ? currentPlan : undefined}
                onUpgrade={handleUpgrade}
                isLoading={isLoading}
                loadingPlan={loadingPlan}
              />
            ))}
          </div>

          {/* Why upgrade */}
          <div className="mt-20 border-t border-white/[0.06] pt-16">
            <h2 className="mb-10 text-center text-2xl font-bold text-white">
              Why upgrade to Pro?
            </h2>
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <span className="font-mono text-lg text-primary">3x</span>
                </div>
                <h3 className="mb-2 font-medium text-white">More Workspaces</h3>
                <p className="text-sm text-white/40">
                  15 workspaces vs 5. Keep more projects active and organized without deleting old work.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Terminal className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-medium text-white">Unlimited Cloud Time</h3>
                <p className="text-sm text-white/40">
                  No more 60-minute daily limits. Work all day in your workspaces without interruptions.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-medium text-white">Custom Subdomains</h3>
                <p className="text-sm text-white/40">
                  Brand your workspaces with custom URLs. <code>yourname.gitterm.dev</code> looks professional.
                </p>
              </div>
            </div>
          </div>

          {/* Questions */}
          <div className="mt-24 border-t border-white/[0.06] pt-16 text-center">
            <h2 className="mb-3 text-2xl font-bold text-white">Questions?</h2>
            <p className="mb-8 text-sm text-white/40">
              Need help choosing the right plan? Reach out on Twitter.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="https://twitter.com/BrightOginni"
                target="_blank"
                className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-6 py-2.5 font-mono text-sm text-white/60 transition-colors hover:border-white/20 hover:text-white"
              >
                Reach out on Twitter
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

export default function PricingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <PricingPageContent />
    </Suspense>
  );
}

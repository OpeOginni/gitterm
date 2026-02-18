"use client";

import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { initiateCheckout, isBillingEnabled, authClient } from "@/lib/auth-client";
import {
  Check,
  Terminal,
  ExternalLink,
  ArrowRight,
  Loader2,
  Package,
} from "lucide-react";
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

interface RunPack {
  runs: number;
  price: number;
  slug: "run_pack_50" | "run_pack_100";
  pricePerRun: string;
}

const PLAN_TIERS: PlanTier[] = [
  {
    name: "Free",
    price: 0,
    description: "Get started with cloud workspaces and agentic coding for free",
    features: [
      "60 minutes/day cloud runtime",
      "Auto-generated subdomains",
      "Persistent storage",
      "Git operations on cloud workspaces",
      "10 sandbox runs / month",
      "Max 40 min per run",
      "Bring-your-own inference",
      "Community support and updates",
    ],
    actionLabel: "Get Started",
  },
  {
    name: "Pro",
    slug: "pro",
    price: 20,
    description: "Full-featured cloud development and agentic coding platform",
    features: [
      "Unlimited loop projects and cloud workspaces",
      "100 sandbox runs / month",
      "Max 40 min per run",
      "Built for professional workflows",
    ],
    popular: true,
    actionLabel: "Go Pro",
  },
  {
    name: "Self-Hosted",
    description: "Full control on your own infrastructure",
    features: [
      "Deploy on Railway, AWS, or your own servers",
      "All features unlocked",
      "No usage limits",
      "Bring your own cloud providers",
      "Complete data ownership",
      "Community-driven updates",
    ],
    exclusive: true,
    isSelfHost: true,
    actionLabel: "Deploy on Railway",
  },
];

const RUN_PACKS: RunPack[] = [
  {
    runs: 50,
    price: 15,
    slug: "run_pack_50",
    pricePerRun: "$0.30",
  },
  {
    runs: 100,
    price: 25,
    slug: "run_pack_100",
    pricePerRun: "$0.25",
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

/* ─── Run pack card ────────────────────────────────────────── */

function RunPackCard({
  pack,
  onPurchase,
  isLoading,
  loadingPack,
}: {
  pack: RunPack;
  onPurchase: (slug: "run_pack_50" | "run_pack_100") => void;
  isLoading: boolean;
  loadingPack?: string | null;
}) {
  const isThisPackLoading = isLoading && loadingPack === pack.slug;

  return (
    <div className="flex w-full max-w-[280px] flex-col justify-between rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            {pack.runs} Runs
          </span>
        </div>
        <div className="mb-1 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-white">${pack.price}</span>
          <span className="text-xs text-white/30">({pack.pricePerRun}/run)</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/40">
          One-time purchase. Runs never expire.
        </p>
      </div>
      <div className="mt-6">
        <button
          onClick={() => onPurchase(pack.slug)}
          disabled={isLoading}
          className={cn(
            "inline-flex w-full cursor-pointer items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-6 py-2.5 font-mono text-sm font-medium text-white/70 transition-colors",
            "hover:border-white/20 hover:text-white",
            "focus:outline-none focus:ring-2 focus:ring-gold/50 focus:ring-offset-2 focus:ring-offset-[#09090b]",
            "disabled:cursor-not-allowed disabled:opacity-70",
          )}
        >
          {isThisPackLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              Buy {pack.runs} Runs
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ─── Page content ─────────────────────────────────────────── */

function PricingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<"pro" | null>(null);
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
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
    if (
      planParam &&
      planParam === "pro" &&
      session?.user &&
      !isLoading
    ) {
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

  const handleRunPackPurchase = async (slug: "run_pack_50" | "run_pack_100") => {
    if (!isBillingEnabled) {
      window.location.href = "/dashboard";
      return;
    }

    if (!session?.user) {
      const redirectUrl = `/pricing?pack=${slug}`;
      router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    setIsLoading(true);
    setLoadingPack(slug);
    try {
      await initiateCheckout(slug);
    } catch (error) {
      console.error("Run pack purchase failed:", error);
    } finally {
      setIsLoading(false);
      setLoadingPack(null);
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

          {/* Run packs */}
          <div className="mt-24 border-t border-white/[0.06] pt-16">
            <div className="mb-10 text-center">
              <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-primary/70">
                Add-ons
              </p>
              <h2 className="mb-2 text-2xl font-bold text-white">
                Need more runs?
              </h2>
              <p className="text-sm text-white/40">
                One-time packs. No subscription required.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center gap-5 sm:flex-row">
              {RUN_PACKS.map((pack) => (
                <RunPackCard
                  key={pack.slug}
                  pack={pack}
                  onPurchase={handleRunPackPurchase}
                  isLoading={isLoading}
                  loadingPack={loadingPack}
                />
              ))}
            </div>

            <p className="mt-6 text-center text-xs text-white/30">
              Pro subscribers get 100 runs/month included ($0.20/run value). Run
              packs are great for power users who need more.
            </p>
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

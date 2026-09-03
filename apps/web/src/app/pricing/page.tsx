"use client";

import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { initiateCheckout, isBillingEnabled, authClient } from "@/lib/auth-client";
import { Check, X, Terminal, ArrowRight, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { GitHub } from "@/components/logos/Github";

type UserPlan = "free" | "starter" | "pro";
type CheckoutPlanSlug = "starter" | "pro";

interface PlanTier {
  name: string;
  slug?: CheckoutPlanSlug;
  price?: number;
  description: string;
  features: string[];
  popular?: boolean;
  actionLabel: string;
}

const PLAN_TIERS: PlanTier[] = [
  {
    name: "Free",
    price: 0,
    description: "Try agentic coding on E2B sandboxes. No card required",
    features: [
      "60 minutes/day cloud runtime",
      "2 concurrent workspaces",
      "2-day idle workspace retention",
      "E2B sandboxes only",
    ],
    actionLabel: "Get Started",
  },
  {
    name: "Starter",
    slug: "starter",
    price: 10,
    description: "For occasional builders who want every provider and persistence",
    features: [
      "180 minutes/day cloud runtime",
      "5 concurrent workspaces",
      "7-day idle workspace retention",
      "All providers available",
      "Teams & Worksapce Sharing",
      "Custom Subdomains",
    ],
    actionLabel: "Choose Starter",
  },
  {
    name: "Pro",
    slug: "pro",
    price: 25,
    description: "For serious solo builders who live in their workspaces",
    features: [
      "480 minutes/day cloud runtime",
      "15 concurrent workspaces",
      "15-day idle workspace retention",
      "All providers available",
      "Teams & Worksapce Sharing",
      "Custom Subdomains",
    ],
    popular: true,
    actionLabel: "Go Pro",
  },
];

const COMPARISON_ROWS: Array<{
  label: string;
  free: string | boolean;
  starter: string | boolean;
  pro: string | boolean;
  selfHosted: string | boolean;
}> = [
  {
    label: "Daily cloud runtime",
    free: "60 min",
    starter: "180 min",
    pro: "480 min",
    selfHosted: "Unlimited",
  },
  {
    label: "Existing workspaces",
    free: "2",
    starter: "5",
    pro: "15",
    selfHosted: "Unlimited",
  },
  {
    label: "Idle workspace retention",
    free: "2 days",
    starter: "7 days",
    pro: "15 days",
    selfHosted: "Unlimited",
  },
  {
    label: "Provider access",
    free: "E2B only",
    starter: "All managed",
    pro: "All managed",
    selfHosted: "Self-managed",
  },
  {
    label: "Persistent workspaces",
    free: false,
    starter: true,
    pro: true,
    selfHosted: true,
  },
  {
    label: "Custom subdomains",
    free: false,
    starter: true,
    pro: true,
    selfHosted: true,
  },
  {
    label: "Join workspaces shared with you",
    free: true,
    starter: true,
    pro: true,
    selfHosted: true,
  },
  {
    label: "Share workspaces & teams",
    free: false,
    starter: true,
    pro: true,
    selfHosted: true,
  },
  {
    label: "Priority provisioning",
    free: false,
    starter: false,
    pro: true,
    selfHosted: false,
  },
];

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span className="text-sm leading-relaxed text-fg-3">{text}</span>
    </div>
  );
}

function ComparisonValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-primary" />
    ) : (
      <X className="mx-auto h-4 w-4 text-fg-4" />
    );
  }

  return <span className="text-fg-3">{value}</span>;
}

function PricingCard({
  plan,
  currentPlan,
  onUpgrade,
  isLoading,
  loadingPlan,
}: {
  plan: PlanTier;
  currentPlan?: UserPlan;
  onUpgrade: (slug: CheckoutPlanSlug) => void;
  isLoading: boolean;
  loadingPlan?: CheckoutPlanSlug | null;
}) {
  const isCurrentPlan = plan.slug && currentPlan === plan.slug;
  const isFreeCurrentPlan = plan.name === "Free" && currentPlan === "free";
  const isThisPlanLoading = isLoading && loadingPlan === plan.slug;

  return (
    <div
      className={cn(
        "relative flex w-full max-w-[420px] flex-col justify-between rounded-2xl border p-5 transition-colors sm:p-6 md:max-w-none",
        plan.popular ? "border-primary/30 bg-primary/[0.04]" : "border-line bg-fill",
      )}
    >
      <div>
        <div className="mb-5 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-4">
            {plan.name}
          </span>
          {plan.popular && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
              Popular
            </span>
          )}
        </div>

        <div className="mb-2 flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white">
            {plan.price !== undefined ? `$${plan.price}` : "Free"}
          </span>
          {plan.price !== undefined && plan.price > 0 && (
            <span className="text-sm text-fg-4">/month</span>
          )}
        </div>

        <p className="mb-6 min-h-[40px] text-sm leading-relaxed text-fg-4">{plan.description}</p>

        <div className="flex flex-col gap-3">
          {plan.features.map((feature) => (
            <FeatureItem key={feature} text={feature} />
          ))}
        </div>
      </div>

      <div className="mt-8">
        {isCurrentPlan || isFreeCurrentPlan ? (
          <span className="inline-flex w-full items-center justify-center rounded-lg border border-line px-6 py-2.5 font-mono text-sm text-fg-4">
            Current Plan
          </span>
        ) : plan.slug ? (
          <button
            onClick={() => onUpgrade(plan.slug!)}
            disabled={isLoading}
            className={cn(
              "inline-flex w-full cursor-pointer items-center justify-center rounded-lg px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-wider transition-all",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
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
            className="inline-flex w-full items-center justify-center rounded-lg border border-line bg-fill px-6 py-2.5 font-mono text-sm font-medium text-fg-2 transition-colors hover:border-line-2 hover:text-fg"
          >
            {plan.actionLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

function PricingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<CheckoutPlanSlug | null>(null);
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
      (planParam === "pro" || planParam === "starter") &&
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

  const currentPlan: UserPlan = session?.user?.plan ?? "free";

  const handleUpgrade = async (slug: CheckoutPlanSlug) => {
    if (!isBillingEnabled) {
      window.location.href = "/dashboard";
      return;
    }

    if (!session?.user) {
      const redirectUrl = `/pricing?plan=${slug}`;
      router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    track("upgrade_initiated", { plan: slug });
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
    <main className="min-h-screen bg-background text-white dark landing-grid grain">
      <LandingHeader />

      <section className="pt-24 pb-16 sm:pt-32 sm:pb-24 md:pt-44 md:pb-32">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
          {/* Header */}
          <div className="mb-10 sm:mb-16">
            <h1 className="font-display text-[clamp(2rem,7vw,5rem)] font-light leading-[1] tracking-tight text-white sm:leading-[0.98]">
              We just <span className="font-display-accent text-[color:var(--cream)]">run</span> the
              workspaces.
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-fg-3 sm:mt-6 sm:text-[17px] sm:leading-[1.65]">
              You bring your model API keys. We don't resell them. GitTerm only charges for the
              cloud workspace itself (compute, storage, and networking) so your AI bill stays with
              your provider, not us.
            </p>
          </div>

          {/* Plan cards */}
          <div className="mx-auto grid max-w-[420px] grid-cols-1 gap-5 md:max-w-none md:grid-cols-3 md:items-stretch">
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

          {/* Self-hosted option */}
          <div className="mx-auto mt-5 flex max-w-[420px] flex-col gap-4 rounded-2xl border border-line bg-fill p-4 sm:px-5 sm:py-4 md:max-w-none md:flex-row md:items-center md:justify-between md:px-6">
            <div className="max-w-2xl">
              <div className="mb-1 flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
                  Open Source
                </span>
                <span className="h-px w-8 bg-primary/25" />
              </div>
              <h2 className="font-display text-xl font-light tracking-tight text-white sm:text-2xl">
                Get all of GitTerm, free.
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-3 sm:text-sm">
                Self-host the complete stack on your own infrastructure. Deploy it in one click or
                fork the MIT-licensed source and run it anywhere.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <Link
                href="https://railway.com/deploy/gitterm?referralCode=o9MFOP&utm_medium=integration&utm_source=template&utm_campaign=generic"
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src="https://railway.com/button.svg"
                  alt="Deploy on Railway"
                  height={40}
                  className="h-10 opacity-90 transition-opacity hover:opacity-100"
                />
              </Link>
              <Link
                href="https://github.com/OpeOginni/gitterm"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-line bg-fill px-5 py-2.5 font-mono text-xs font-medium text-fg-2 transition-colors hover:border-line-2 hover:bg-fill-2 hover:text-fg"
              >
                <GitHub className="mr-2 h-4 w-4" />
                View on GitHub
              </Link>
            </div>
          </div>

          {/* Plan comparison */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-line bg-fill sm:mt-16">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-5 sm:px-6">
              <div>
                <h2 className="font-display text-2xl font-light tracking-tight text-white md:text-3xl">
                  Same shape, different ceilings.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-fg-4">
                Workspace counts mean existing cloud workspaces, whether paused or live. Runtime is
                only consumed while managed workspaces are active.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-fill font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">
                    <th className="px-5 py-3 text-left font-medium">Feature</th>
                    <th className="px-4 py-3 text-center font-medium">Free</th>
                    <th className="px-4 py-3 text-center font-medium">Starter</th>
                    <th className="px-4 py-3 text-center font-medium text-primary">Pro</th>
                    <th className="px-4 py-3 text-center font-medium">Self-hosted</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-line last:border-b-0">
                      <td className="px-5 py-4 text-fg-2">{row.label}</td>
                      <td className="px-4 py-4 text-center">
                        <ComparisonValue value={row.free} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <ComparisonValue value={row.starter} />
                      </td>
                      <td className="bg-primary/2.5 px-4 py-4 text-center">
                        <ComparisonValue value={row.pro} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        <ComparisonValue value={row.selfHosted} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* BYOK explainer */}
          <div className="mt-12 max-w-2xl border-t border-line pt-10 sm:mt-16 sm:pt-12">
            <h3 className="mb-3 font-display text-xl font-light tracking-tight text-white">
              No AI markup. No middleman.
            </h3>
            <p className="text-sm leading-relaxed text-fg-3">
              You bring your own Model Provider keys/subscriptions. <br /> Paid plans only cover the
              cloud workspace itself: compute, storage, and multi-cloud orchestration.
            </p>
          </div>

          {/* Questions */}
          <section
            id="questions"
            className="mt-16 border-t border-line pt-12 text-center sm:mt-24 sm:pt-16"
          >
            <h2 className="mb-3 font-display text-2xl font-light tracking-tight text-white">
              Questions?
            </h2>
            <p className="mb-8 text-sm text-fg-4">
              Need help choosing the right plan? Reach out by email.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="mailto:help@gitterm.dev"
                className="inline-flex items-center justify-center rounded-lg border border-line bg-fill px-6 py-2.5 font-mono text-sm text-fg-2 transition-colors hover:border-line-2 hover:text-fg"
              >
                Reach out by email
                <Mail className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </section>
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
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <PricingPageContent />
    </Suspense>
  );
}

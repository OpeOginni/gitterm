"use client";

import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import {
  initiateCheckout,
  isBillingEnabled,
  authClient,
} from "@/lib/auth-client";
import {
  Check,
  X,
  Terminal,
  ExternalLink,
  ArrowRight,
  Loader2,
  Globe,
  KeyRound,
  Mail,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";

type UserPlan = "free" | "starter" | "pro";
type CheckoutPlanSlug = "starter" | "pro";

interface PlanTier {
  name: string;
  slug?: CheckoutPlanSlug;
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
    description: "Try agentic coding on E2B sandboxes. No card required",
    features: [
      "60 minutes/day cloud runtime",
      "10 agent runs/month",
      "2 existing workspaces",
      "E2B sandbox provider only",
      "Bring-your-own API keys",
    ],
    actionLabel: "Get Started",
  },
  {
    name: "Starter",
    slug: "starter",
    price: 10,
    description:
      "For occasional builders who want every provider and persistence",
    features: [
      "180 minutes/day cloud runtime",
      "75 agent runs/month",
      "5 existing workspaces",
      "All providers (E2B, Daytona, Cloudflare, Railway)",
      "Persistent workspaces",
      "Custom subdomains for branding",
      "Bring-your-own API keys",
    ],
    popular: true,
    actionLabel: "Choose Starter",
  },
  {
    name: "Pro",
    slug: "pro",
    price: 25,
    description: "For serious solo builders who live in their workspaces",
    features: [
      "480 minutes/day cloud runtime",
      "250 agent runs/month",
      "15 existing workspaces",
      "All providers, persistence included",
      "Custom subdomains for branding",
      "Priority provisioning & support",
      "Bring-your-own API keys",
    ],
    actionLabel: "Go Pro",
  },
  {
    name: "Self-Hosted",
    description:
      "Full control with unlimited everything on your own infrastructure",
    features: [
      "Unlimited cloud runtime & workspaces",
      "Deploy on Railway, AWS, or bare metal",
      "All Pro features unlocked",
      "Run your own provider credentials",
      "Complete data ownership & privacy",
      "Community-driven open source",
    ],
    exclusive: true,
    isSelfHost: true,
    actionLabel: "Deploy on Railway",
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
    label: "Agent runs/month",
    free: "10",
    starter: "75",
    pro: "250",
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
      <span className="text-sm leading-relaxed text-white/50">{text}</span>
    </div>
  );
}

function ComparisonValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-primary" />
    ) : (
      <X className="mx-auto h-4 w-4 text-white/20" />
    );
  }

  return <span className="text-white/55">{value}</span>;
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
        "relative flex w-full max-w-[420px] flex-col justify-between rounded-2xl border p-5 transition-colors sm:p-6 xl:max-w-none xl:flex-1 xl:basis-0",
        plan.popular
          ? "border-primary/30 bg-primary/[0.04]"
          : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
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

        <div className="flex flex-col gap-3">
          {plan.features.map((feature) => (
            <FeatureItem key={feature} text={feature} />
          ))}
        </div>
      </div>

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
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-[#09090b]",
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

  const currentPlan = ((session?.user as any)?.plan as UserPlan) || "free";

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
            <div className="mb-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="marker">Pricing · plain &amp; predictable</span>
            </div>
            <h1 className="font-display text-[clamp(2rem,7vw,5rem)] font-light leading-[1] tracking-tight text-white sm:leading-[0.98]">
              We just{" "}
              <span className="font-display-italic text-[color:var(--cream)]">
                run
              </span>{" "}
              the workspaces.
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-white/55 sm:mt-6 sm:text-[17px] sm:leading-[1.65]">
              You bring your model API keys. We don't resell them. GitTerm only
              charges for the cloud workspace itself (compute, storage, and
              networking) so your AI bill stays with your provider, not us.
            </p>
          </div>

          {/* Plan cards */}
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center gap-5 xl:max-w-none xl:flex-row xl:items-stretch">
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

          {/* Plan comparison */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015] sm:mt-16">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-5 py-5 sm:px-6">
              <div>
                <span className="marker">Compare plans</span>
                <h2 className="mt-3 font-display text-2xl font-light tracking-tight text-white md:text-3xl">
                  Same shape, different ceilings.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-white/40">
                Workspace counts mean existing cloud workspaces, whether paused
                or live. Runtime is only consumed while managed workspaces are
                active.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02] font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                    <th className="px-5 py-3 text-left font-medium">Feature</th>
                    <th className="px-4 py-3 text-center font-medium">Free</th>
                    <th className="px-4 py-3 text-center font-medium text-primary">
                      Starter
                    </th>
                    <th className="px-4 py-3 text-center font-medium">Pro</th>
                    <th className="px-4 py-3 text-center font-medium">
                      Self-hosted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.label}
                      className="border-b border-white/[0.035] last:border-b-0"
                    >
                      <td className="px-5 py-4 text-white/75">{row.label}</td>
                      <td className="px-4 py-4 text-center">
                        <ComparisonValue value={row.free} />
                      </td>
                      <td className="bg-primary/[0.025] px-4 py-4 text-center">
                        <ComparisonValue value={row.starter} />
                      </td>
                      <td className="px-4 py-4 text-center">
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
          <div className="mt-12 border-t border-white/[0.06] pt-10 sm:mt-16 sm:pt-12">
            <div className="mb-8 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="marker">Bring your own keys</span>
            </div>
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <h3 className="mb-3 font-display text-xl font-light tracking-tight text-white">
                  No AI markup. No middleman.
                </h3>
                <p className="text-sm leading-relaxed text-white/50">
                  GitTerm never resells AI model access. You bring your own
                  Anthropic, OpenAI, or Copilot credentials and we inject them
                  into your workspaces. Your AI spending is between you and the
                  provider. We don't take a cut.
                </p>
              </div>
              <div>
                <h3 className="mb-3 font-display text-xl font-light tracking-tight text-white">
                  What your plan actually covers.
                </h3>
                <p className="text-sm leading-relaxed text-white/50">
                  Paid plans pay for cloud workspace infrastructure: compute
                  time, persistent storage, subdomain hosting, and our
                  multi-cloud orchestration layer. Think of it as renting a
                  purpose-built VM fleet for your agents, not a SaaS
                  subscription with hidden AI fees. Free runs on E2B sandboxes;
                  Starter and Pro unlock every provider.
                </p>
              </div>
            </div>
          </div>

          {/* Why upgrade */}
          <div className="mt-14 border-t border-white/[0.06] pt-12 sm:mt-20 sm:pt-16">
            <div className="mb-10 flex items-baseline gap-3">
              <h2 className="font-display text-2xl font-light tracking-tight text-white md:text-3xl">
                Why{" "}
                <span className="font-display-italic text-[color:var(--cream)]">
                  upgrade
                </span>
                ?
              </h2>
            </div>
            <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-medium text-white">Every Provider</h3>
                <p className="text-sm text-white/40">
                  Free is limited to E2B sandboxes. Starter and Pro unlock
                  Daytona, Cloudflare, and Railway so you can pick the right
                  runtime per project.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Terminal className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-medium text-white">
                  More Runtime & Runs
                </h3>
                <p className="text-sm text-white/40">
                  Up to 480 minutes/day and 250 agent runs/month on Pro. Room to
                  actually live in your workspaces instead of watching a
                  60-minute clock.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-medium text-white">
                  Persistence & Branding
                </h3>
                <p className="text-sm text-white/40">
                  Paid plans keep persistent workspaces across restarts. Pro
                  adds custom subdomains like{" "}
                  <code className="text-white/60">yourname.gitterm.dev</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Questions */}
          <section
            id="questions"
            className="mt-16 border-t border-white/[0.06] pt-12 text-center sm:mt-24 sm:pt-16"
          >
            <h2 className="mb-3 font-display text-2xl font-light tracking-tight text-white">
              Questions?
            </h2>
            <p className="mb-8 text-sm text-white/40">
              Need help choosing the right plan? Reach out by email.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="mailto:help@gitterm.dev"
                className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-6 py-2.5 font-mono text-sm text-white/60 transition-colors hover:border-white/20 hover:text-white"
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

"use client";

import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { initiateCheckout, isBillingEnabled, authClient } from "@/lib/auth-client";
import {
  Check,
  X,
  Terminal,
  ArrowRight,
  Loader2,
  Mail,
  Gauge,
  Pause,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { useCurrentPlan } from "@/lib/billing";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { formatMachineSize } from "@/components/dashboard/create-instance/types";

type UserPlan = "free" | "pro" | "growth" | "starter";
type CheckoutPlanSlug = "pro" | "growth";

interface PlanCard {
  id: "free" | "pro" | "growth";
  name: string;
  slug?: CheckoutPlanSlug;
  price: number;
  tagline: string;
  /** `**text**` renders bold. The first line is the included compute. */
  features: string[];
  cta: string;
  featured?: boolean;
}

const PLANS: PlanCard[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "Try GitTerm. No card needed.",
    features: [
      "**60 min** of compute a day",
      "**Small** machines · 2 vCPU, 4 GB",
      "boat (EU) or E2B (US)",
      "**2** workspaces · **2-day** retention",
    ],
    cta: "Start free",
  },
  {
    id: "pro",
    name: "Pro",
    slug: "pro",
    price: 25,
    tagline: "For builders who ship every day.",
    features: [
      "**$25** of compute every month",
      "**Every** provider and machine size",
      "**Always-on** workspaces, no daily limit",
      "Pay-as-you-go with **your** spending cap",
      "**15** workspaces · **15-day** retention",
      "Custom subdomains and persistence",
    ],
    cta: "Get Pro",
  },
  {
    id: "growth",
    name: "Growth",
    slug: "growth",
    price: 200,
    tagline: "For teams running workspaces all month.",
    features: [
      "**$250** of compute every month",
      "**10% off** pay-as-you-go",
      "**Every** provider and machine size",
      "**Always-on** workspaces, no daily limit",
      "**50** workspaces · **30-day** retention",
      "Custom subdomains and persistence",
    ],
    cta: "Get Growth",
    featured: true,
  },
];

const COMPARISON_ROWS: Array<{
  label: string;
  free: string | boolean;
  pro: string | boolean;
  growth: string | boolean;
}> = [
  {
    label: "Compute included",
    free: "**60 min**/day",
    pro: "**$25**/month",
    growth: "**$250**/month",
  },
  { label: "Pay-as-you-go", free: false, pro: "List price", growth: "**10% off**" },
  { label: "Daily runtime limit", free: "60 min", pro: "None", growth: "None" },
  { label: "Machine sizes", free: "Small", pro: "All", growth: "All" },
  { label: "Providers", free: "boat, E2B", pro: "All", growth: "All" },
  { label: "Always-on workspaces", free: false, pro: true, growth: true },
  { label: "Workspaces", free: "**2**", pro: "**15**", growth: "**50**" },
  { label: "Idle retention", free: "2 days", pro: "15 days", growth: "30 days" },
  { label: "Persistent workspaces", free: false, pro: true, growth: true },
  { label: "Custom subdomains", free: false, pro: true, growth: true },
];

const HOW_BILLING_WORKS = [
  {
    icon: Gauge,
    title: "Billed by the second",
    body: "Running workspaces draw from your balance at each machine's hourly rate.",
  },
  {
    icon: Pause,
    title: "Stopped costs nothing",
    body: "Paused workspaces keep your files and use no compute.",
  },
  {
    icon: ShieldCheck,
    title: "You set the cap",
    body: "Stop at your balance, or turn on pay-as-you-go with a monthly limit.",
  },
];

/** Renders `**bold**` segments as emphasised text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
        part.startsWith("**") ? (
          <strong key={index} className="font-semibold text-fg">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function ComparisonValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-primary" aria-label="Included" />
    ) : (
      <X className="mx-auto h-4 w-4 text-fg-4" aria-label="Not included" />
    );
  }
  return (
    <span className="text-fg-3">
      <Rich text={value} />
    </span>
  );
}

function PlanCardView({
  plan,
  currentPlan,
  onUpgrade,
  isLoading,
  loadingPlan,
}: {
  plan: PlanCard;
  currentPlan?: UserPlan;
  onUpgrade: (slug: CheckoutPlanSlug) => void;
  isLoading: boolean;
  loadingPlan?: CheckoutPlanSlug | null;
}) {
  const isCurrent = currentPlan === plan.id;
  const isThisPlanLoading = isLoading && loadingPlan === plan.slug;
  const buttonClass = cn(
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-70",
  );

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border p-6 sm:p-7",
        plan.featured
          ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_60px_-20px] shadow-primary/40"
          : "border-line bg-fill",
      )}
    >
      {plan.featured ? (
        <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary-foreground">
          Best value
        </span>
      ) : null}

      <h2 className="text-lg font-semibold text-fg">{plan.name}</h2>
      <p className="mt-1 text-sm text-fg-3">{plan.tagline}</p>

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-5xl font-semibold tracking-tight text-fg tabular-nums">
          ${plan.price}
        </span>
        <span className="text-sm text-fg-4">/month</span>
      </div>

      <div className="mt-6">
        {isCurrent ? (
          <span className={cn(buttonClass, "border border-line text-fg-4")}>Current plan</span>
        ) : plan.slug ? (
          <button
            type="button"
            onClick={() => onUpgrade(plan.slug!)}
            disabled={isLoading}
            className={cn(
              buttonClass,
              "cursor-pointer",
              plan.featured
                ? "bg-primary text-primary-foreground hover:bg-primary/85"
                : "bg-fg text-background hover:bg-fg-2",
            )}
          >
            {isThisPlanLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                {plan.cta}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        ) : (
          <Link
            href="/dashboard"
            className={cn(
              buttonClass,
              "border border-line bg-fill text-fg-2 hover:border-line-2 hover:text-fg",
            )}
          >
            {plan.cta}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-fg-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <Rich text={feature} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Hourly price of every machine size, from the billing rate card. */
function RateCard() {
  const { data: rates } = useQuery(trpc.billing.rates.queryOptions());
  if (!rates || rates.length === 0) return null;

  return (
    <section className="mt-16 sm:mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="marker">Compute rates</p>
          <h2 className="mt-3 font-display text-2xl font-light tracking-tight text-fg md:text-3xl">
            What your balance buys.
          </h2>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-fg-3">
          Per running hour, metered by the second. Free plans run on the smallest sizes.
        </p>
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-fill">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">
              <th className="px-5 py-3 text-left font-medium">Provider</th>
              <th className="px-4 py-3 text-left font-medium">Size</th>
              <th className="px-4 py-3 text-left font-medium">Machine</th>
              <th className="px-5 py-3 text-right font-medium">Per hour</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <tr
                key={`${rate.provider}-${rate.name}`}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-5 py-3 text-fg-2">
                  {rate.provider}
                  {rate.location ? (
                    <span className="ml-2 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-4">
                      {rate.location}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-fg-3">{rate.name}</td>
                <td className="px-4 py-3 text-fg-4">{formatMachineSize(rate) ?? "—"}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-fg">
                  ${(rate.priceMicrosPerHour / 1_000_000).toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PricingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<CheckoutPlanSlug | null>(null);
  const { data: session } = authClient.useSession();
  const currentPlan = useCurrentPlan() as UserPlan;
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
      (planParam === "pro" || planParam === "growth") &&
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
    <main className="min-h-screen bg-background text-fg dark landing-grid grain">
      <LandingHeader />

      <section className="pt-24 pb-16 sm:pt-32 sm:pb-24 md:pt-40 md:pb-32">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          {/* Header */}
          <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
            <p className="marker">Pricing</p>
            <h1 className="mt-4 font-display text-[clamp(2.25rem,7vw,4.5rem)] font-light leading-[1] tracking-tight text-fg">
              Pay for the{" "}
              <span className="font-display-accent text-[color:var(--cream)]">compute</span>.
              Nothing else.
            </h1>
            <p className="mt-5 text-[15px] leading-[1.6] text-fg-3 sm:text-[17px]">
              Every paid plan is a monthly compute balance, billed by the second. Bring your own
              model keys: we never mark up AI.
            </p>
          </div>

          {/* Plan cards */}
          <div className="mx-auto grid max-w-[440px] grid-cols-1 gap-6 md:max-w-none md:grid-cols-3 md:items-stretch">
            {PLANS.map((plan) => (
              <PlanCardView
                key={plan.id}
                plan={plan}
                currentPlan={session ? currentPlan : undefined}
                onUpgrade={handleUpgrade}
                isLoading={isLoading}
                loadingPlan={loadingPlan}
              />
            ))}
          </div>

          {/* How billing works */}
          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
            {HOW_BILLING_WORKS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-background p-6">
                <Icon className="h-5 w-5 text-primary" />
                <p className="mt-3 text-sm font-semibold text-fg">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-fg-3">{body}</p>
              </div>
            ))}
          </div>

          {/* Plan comparison */}
          <section className="mt-16 sm:mt-24">
            <p className="marker">Compare plans</p>
            <h2 className="mt-3 font-display text-2xl font-light tracking-tight text-fg md:text-3xl">
              Same product, bigger balance.
            </h2>
            <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-fill">
              <table className="w-full border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">
                    <th className="px-3 py-3 text-left font-medium sm:px-5">Feature</th>
                    <th className="px-2 py-3 text-center font-medium sm:px-4">Free</th>
                    <th className="px-2 py-3 text-center font-medium sm:px-4">Pro</th>
                    <th className="bg-primary/[0.08] px-2 py-3 text-center font-medium text-primary sm:px-4">
                      Growth
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-3.5 text-fg-2 sm:px-5">{row.label}</td>
                      <td className="px-2 py-3.5 text-center sm:px-4">
                        <ComparisonValue value={row.free} />
                      </td>
                      <td className="px-2 py-3.5 text-center sm:px-4">
                        <ComparisonValue value={row.pro} />
                      </td>
                      <td className="bg-primary/[0.08] px-2 py-3.5 text-center sm:px-4">
                        <ComparisonValue value={row.growth} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-fg-4">
              Workspaces count every cloud workspace you keep, running or paused.
            </p>
          </section>

          <RateCard />

          {/* Closing */}
          <section className="mt-16 grid gap-8 border-t border-line pt-12 sm:mt-24 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="font-display text-2xl font-light tracking-tight text-fg">
                No AI markup. No middleman.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-fg-3">
                Your model keys and subscriptions stay yours. Plans only cover the workspace:
                compute, storage, and orchestration.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <Link
                href="mailto:help@gitterm.dev"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-fill px-5 text-sm font-medium text-fg-2 transition-colors hover:border-line-2 hover:text-fg"
              >
                Questions? Email us
                <Mail className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <p className="mt-12 text-center text-sm text-fg-3">
            Want to run GitTerm on your own infra?{" "}
            <Link
              href="/self-host"
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              Self-host it
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
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

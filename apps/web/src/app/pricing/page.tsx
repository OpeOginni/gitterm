"use client";

import { initiateCheckout, isBillingEnabled, authClient } from "@/lib/auth-client";
import { Check, Minus, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { useCurrentPlan } from "@/lib/billing";
import { SiteShell } from "@/components/site/site-shell";
import { Band, SectionHead, Wrap } from "@/components/site/section";

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
      "**Every** machine size",
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
      "**Every** machine size",
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
  { label: "Always-on workspaces", free: false, pro: true, growth: true },
  { label: "Workspaces", free: "**2**", pro: "**15**", growth: "**50**" },
  { label: "Idle retention", free: "2 days", pro: "15 days", growth: "30 days" },
  { label: "Persistent workspaces", free: false, pro: true, growth: true },
  { label: "Custom subdomains", free: false, pro: true, growth: true },
];

const HOW_BILLING_WORKS = [
  {
    title: "Billed by the second",
    body: "Running workspaces draw from your balance at each machine's hourly rate.",
  },
  {
    title: "Stopped costs nothing",
    body: "Paused workspaces keep your files and use no compute.",
  },
  {
    title: "You set the cap",
    body: "Stop at your balance, or turn on pay-as-you-go with a monthly limit.",
  },
];

const primaryButton =
  "bg-primary text-primary-foreground hover:bg-[#c09a45] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const secondaryButton =
  "bg-white/[0.04] text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.07] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Renders `**bold**` segments as emphasised text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
        part.startsWith("**") ? (
          <strong key={index} className="font-medium text-fg">
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
      <Check className="mx-auto size-4 text-[#e2c47c]" aria-label="Included" />
    ) : (
      <Minus className="mx-auto size-4 text-fg-4" aria-label="Not included" />
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
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[14.5px] font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-70",
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl px-6 py-8 sm:px-8",
        plan.featured
          ? "bg-card shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),0_30px_80px_-40px_rgba(0,0,0,0.8)] md:-my-5 md:py-[52px]"
          : "",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[19px] font-medium tracking-[-0.02em] text-fg">{plan.name}</h2>
        {plan.featured ? (
          <span className="text-[13px] font-medium text-[#e2c47c]">Best value</span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[15px] text-fg-3">{plan.tagline}</p>

      <div className="mt-7 flex items-baseline gap-1.5">
        <span className="text-[3rem] leading-none font-normal tracking-[-0.04em] text-fg tabular-nums">
          ${plan.price}
        </span>
        <span className="text-[15px] text-fg-4">/month</span>
      </div>

      <div className="mt-7">
        {isCurrent ? (
          <span
            className={cn(buttonClass, "text-fg-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]")}
          >
            Current plan
          </span>
        ) : plan.slug ? (
          <button
            type="button"
            onClick={() => onUpgrade(plan.slug!)}
            disabled={isLoading}
            className={cn(
              buttonClass,
              "cursor-pointer",
              plan.featured ? primaryButton : secondaryButton,
            )}
          >
            {isThisPlanLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                {plan.cta}
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        ) : (
          <Link href="/dashboard" className={cn(buttonClass, secondaryButton)}>
            {plan.cta}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      <ul className="mt-8 flex flex-col gap-3.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-[15px] leading-[1.5] text-fg-3">
            <Check className="mt-[3px] size-4 shrink-0 text-[#e2c47c]" />
            <span>
              <Rich text={feature} />
            </span>
          </li>
        ))}
      </ul>
    </div>
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

    track("checkout_started", { plan: slug, source: "pricing" });
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
    <SiteShell>
      <Wrap className="pt-[clamp(56px,8vw,104px)] pb-[clamp(64px,9vw,112px)]">
        <div className="mx-auto max-w-[44rem] text-center">
          <h1 className="m-0 text-[clamp(2.4rem,5.6vw,4.4rem)] leading-[1] font-display font-semibold tracking-[-0.035em] text-balance text-fg">
            Pay for the compute. Nothing else.
          </h1>
          <p className="mx-auto mt-6 max-w-[36rem] text-[clamp(16px,1.5vw,18px)] leading-[1.65] text-pretty text-fg-3">
            Every paid plan is a monthly compute balance, billed by the second. Bring your own model
            keys: we never mark up AI.
          </p>
        </div>

        <div className="mx-auto mt-[clamp(48px,6vw,80px)] grid max-w-[440px] grid-cols-1 gap-4 md:max-w-none md:grid-cols-3 md:items-stretch md:gap-2">
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

        <div className="mt-[clamp(48px,6vw,80px)] grid gap-px border border-line bg-line sm:grid-cols-3">
          {HOW_BILLING_WORKS.map(({ title, body }) => (
            <div key={title} className="bg-background px-6 pt-6 pb-7">
              <h3 className="m-0 text-[16.5px] font-medium text-fg">{title}</h3>
              <p className="mt-2 text-[15px] leading-[1.6] text-fg-3">{body}</p>
            </div>
          ))}
        </div>
      </Wrap>

      <Band>
        <Wrap>
          <SectionHead title="Same product, bigger balance.">
            Workspaces count every cloud workspace you keep, running or paused.
          </SectionHead>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px] sm:text-[15px]">
              <thead>
                <tr className="border-b border-line-2 text-fg-2">
                  <th className="py-3.5 pr-2 text-left sm:pr-4 font-medium">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th className="w-[22%] px-1 py-3.5 sm:px-3 text-center font-medium">Free</th>
                  <th className="w-[22%] px-1 py-3.5 sm:px-3 text-center font-medium">Pro</th>
                  <th className="w-[22%] rounded-t-xl bg-card px-1 py-3.5 sm:px-3 text-center font-medium text-[#e2c47c]">
                    Growth
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-line last:border-b-0">
                    <td className="py-4 pr-2 text-fg-2 sm:pr-4">{row.label}</td>
                    <td className="px-1 py-4 text-center sm:px-3">
                      <ComparisonValue value={row.free} />
                    </td>
                    <td className="px-1 py-4 text-center sm:px-3">
                      <ComparisonValue value={row.pro} />
                    </td>
                    <td className="bg-card px-1 py-4 text-center sm:px-3">
                      <ComparisonValue value={row.growth} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Wrap>
      </Band>

      <Band>
        <Wrap>
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <h2 className="m-0 text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.04] font-display font-medium tracking-[-0.025em] text-balance text-fg">
                No AI markup. No middleman.
              </h2>
              <p className="mt-4 max-w-[34rem] text-[16px] leading-[1.6] text-fg-3">
                Your model keys and subscriptions stay yours. Plans only cover the workspace:
                compute, storage, and orchestration.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="mailto:help@gitterm.dev"
                className={cn(
                  "inline-flex h-11 items-center justify-center rounded-lg px-4 text-[14.5px] font-medium transition-colors",
                  secondaryButton,
                )}
              >
                Questions? Email us
              </Link>
              <Link
                href="/dashboard"
                className={cn(
                  "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-[14.5px] font-medium transition-colors",
                  primaryButton,
                )}
              >
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
          <p className="mt-12 text-[15px] text-fg-3">
            Want to run GitTerm on your own infra?{" "}
            <Link
              href="/self-host"
              className="font-medium whitespace-nowrap text-[#e2c47c] underline decoration-[#e2c47c]/40 underline-offset-4 transition-colors hover:decoration-[#e2c47c]"
            >
              Self-host it
            </Link>
          </p>
        </Wrap>
      </Band>
    </SiteShell>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="dark min-h-screen bg-background" />}>
      <PricingPageContent />
    </Suspense>
  );
}

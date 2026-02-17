"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LandingHeader } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { initiateCheckout, isBillingEnabled, authClient } from "@/lib/auth-client";
import {
  CheckCircle2,
  Terminal,
  Zap,
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

const CheckItem = ({ text }: { text: string }) => (
  <div className="flex gap-2">
    <CheckCircle2 size={18} className="my-auto text-green-500 shrink-0" />
    <p className="pt-0.5 text-muted-foreground text-sm">{text}</p>
  </div>
);

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
    <Card className="w-full max-w-[280px] flex flex-col justify-between py-1 mx-auto sm:mx-0 border-dashed">
      <div>
        <CardHeader className="pb-4 pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className="text-muted-foreground text-lg">{pack.runs} Runs</CardTitle>
          </div>
          <div className="flex gap-0.5 items-baseline">
            <h3 className="text-2xl font-bold">${pack.price}</h3>
            <span className="text-sm text-muted-foreground ml-2">({pack.pricePerRun}/run)</span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            One-time purchase. Runs never expire and can be used anytime.
          </p>
        </CardContent>
      </div>
      <CardFooter className="mt-2 mb-2">
        <button
          onClick={() => onPurchase(pack.slug)}
          disabled={isLoading}
          className={cn(
            "relative inline-flex w-full items-center justify-center rounded-md px-6 py-2.5 text-sm font-medium transition-all cursor-pointer",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
            "disabled:opacity-70 disabled:cursor-not-allowed",
            "bg-primary text-primary-foreground hover:bg-primary/90",
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
      </CardFooter>
    </Card>
  );
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
  onUpgrade: (slug: "pro") => void;
  isLoading: boolean;
  loadingPlan?: "pro" | null;
}) {
  const isCurrentPlan = plan.slug && currentPlan === plan.slug;
  const isFreeCurrentPlan = plan.name === "Free" && currentPlan === "free";
  const isThisPlanLoading = isLoading && loadingPlan === plan.slug;

  return (
    <Card
      className={cn(
        "w-full max-w-[320px] flex flex-col justify-between py-1 mx-auto sm:mx-0",
        plan.popular && "border-primary shadow-lg shadow-primary/20",
        plan.exclusive &&
          "animate-background-shine bg-background dark:bg-[linear-gradient(110deg,#000103,45%,#1e2631,55%,#000103)] bg-[length:200%_100%] transition-colors border-muted-foreground/30",
      )}
    >
      <div>
        <CardHeader className="pb-8 pt-4">
          <div className="flex justify-between items-center">
            <CardTitle className="text-muted-foreground text-lg">{plan.name}</CardTitle>
            {plan.popular && (
              <div className="px-2.5 rounded-xl h-fit text-xs py-1 font-medium bg-gradient-to-r from-orange-400 to-rose-400 text-black">
                Most Popular
              </div>
            )}
            {plan.exclusive && (
              <div className="px-2.5 rounded-xl h-fit text-xs py-1 font-medium bg-muted text-foreground">
                Open Source
              </div>
            )}
          </div>
          <div className="flex gap-0.5 items-baseline">
            <h3 className="text-3xl font-bold">
              {plan.price !== undefined ? `$${plan.price}` : "Free"}
            </h3>
            {plan.price !== undefined && plan.price > 0 && (
              <span className="flex flex-col justify-end text-sm text-muted-foreground mb-1">
                /month
              </span>
            )}
          </div>
          <CardDescription className="pt-1.5 min-h-12">{plan.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {plan.features.map((feature) => (
            <CheckItem key={feature} text={feature} />
          ))}
        </CardContent>
      </div>
      <CardFooter className="mt-2 mb-2">
        {plan.isSelfHost ? (
          <Link
            href="https://railway.com/template/gitterm?referralCode=o9MFOP"
            target="_blank"
            className={cn(
              "relative inline-flex w-full items-center justify-center rounded-md px-6 py-2.5 text-sm font-medium transition-colors",
              "bg-foreground text-background hover:bg-foreground/90",
              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
            )}
          >
            <div className="absolute -inset-0.5 -z-10 rounded-lg bg-gradient-to-b from-muted to-primary/50 opacity-75 blur" />
            {plan.actionLabel}
            <ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        ) : isCurrentPlan || isFreeCurrentPlan ? (
          <span className="inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-6 py-2.5 text-sm font-medium text-muted-foreground">
            Current Plan
          </span>
        ) : plan.slug ? (
          <button
            onClick={() => onUpgrade(plan.slug!)}
            disabled={isLoading}
            className={cn(
              "relative inline-flex w-full items-center justify-center rounded-md px-6 py-2.5 text-sm font-medium transition-all cursor-pointer",
              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
              "disabled:opacity-70 disabled:cursor-not-allowed",
              plan.popular
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {plan.popular && (
              <div className="absolute -inset-0.5 -z-10 rounded-lg bg-gradient-to-b from-[#c7d2fe] to-[#8678f9] opacity-75 blur" />
            )}
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
            className={cn(
              "inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-6 py-2.5 text-sm font-medium",
              "hover:bg-accent hover:text-accent-foreground transition-colors",
            )}
          >
            {plan.actionLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}

function PricingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<"pro" | null>(null);
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pricingEnabled = isBillingEnabled;

  // Redirect if pricing is disabled
  useEffect(() => {
    if (!pricingEnabled) {
      router.replace("/");
    }
  }, [pricingEnabled, router]);

  // Auto-trigger checkout if user returns from login with a plan parameter
  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (
      planParam &&
      (planParam === "pro") &&
      session?.user &&
      !isLoading
    ) {
      // User is logged in and has a plan parameter, trigger checkout
      const triggerCheckout = async () => {
        setIsLoading(true);
        setLoadingPlan(planParam);
        try {
          await initiateCheckout(planParam);
          // Remove plan param from URL after initiating checkout
          router.replace("/pricing");
        } catch (error) {
          console.error("Checkout failed:", error);
          // Remove plan param even on error
          router.replace("/pricing");
        } finally {
          setIsLoading(false);
          setLoadingPlan(null);
        }
      };
      triggerCheckout();
    }
  }, [searchParams, session?.user, router, isLoading]);

  // Don't render if pricing is disabled
  if (!pricingEnabled) {
    return null;
  }

  const currentPlan = ((session?.user as any)?.plan as UserPlan) || "free";

  const handleUpgrade = async (slug: "pro") => {
    if (!isBillingEnabled) {
      // If billing is not enabled but pricing is shown, redirect to dashboard
      window.location.href = "/dashboard";
      return;
    }

    // Check if user is logged in
    if (!session?.user) {
      // Redirect to login with plan parameter in redirect URL
      const redirectUrl = `/pricing?plan=${slug}`;
      router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    // User is logged in, proceed with checkout
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

    // Check if user is logged in
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
    <main className="min-h-screen bg-background">
      <LandingHeader />

      <section className="pt-32 pb-20 md:pt-40 md:pb-32">
        <div className="mx-auto max-w-6xl px-6">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl mb-4">
              Simple, transparent pricing
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Powerful agentic coding with predictable pricing. No surprise bills.
            </p>
          </div>

          {/* Pricing Cards */}
          <section className="flex flex-col sm:flex-row sm:flex-wrap justify-center gap-8">
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
          </section>

          {/* Run Packs Section */}
          <div className="mt-20">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">Need more runs?</h2>
              <p className="text-muted-foreground">
                Purchase run packs for additional sandbox runs. No subscription required.
              </p>
            </div>
            <section className="flex flex-col sm:flex-row sm:flex-wrap justify-center gap-6">
              {RUN_PACKS.map((pack) => (
                <RunPackCard
                  key={pack.slug}
                  pack={pack}
                  onPurchase={handleRunPackPurchase}
                  isLoading={isLoading}
                  loadingPack={loadingPack}
                />
              ))}
            </section>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Pro subscribers get 100 runs/month included ($0.20/run value). Run packs are great for
              power users who need more.
            </p>
          </div>

          {/* FAQ or Additional Info */}
          <div className="mt-20 text-center">
            <h2 className="text-2xl font-bold mb-4">Questions?</h2>
            <p className="text-muted-foreground mb-6">
              Need help choosing the right plan? Reach out on Twitter.
            </p>
            <div className="flex justify-center gap-4 flex-wrap">
              <Link
                href="https://twitter.com/BrightOginni"
                target="_blank"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Reach out on Twitter
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
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
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <PricingPageContent />
    </Suspense>
  );
}

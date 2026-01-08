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
import { CheckCircle2, Terminal, Zap, ExternalLink, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";

type UserPlan = "free" | "tunnel" | "pro";

interface PlanTier {
  name: string;
  slug?: "tunnel" | "pro";
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
    description: "Get started with cloud workspaces",
    features: [
      "60 minutes/day cloud runtime",
      "Auto-generated subdomains",
      "GitHub integration",
      "Persistent storage",
      "Community support",
    ],
    actionLabel: "Get Started",
  },
  {
    name: "Tunnel",
    slug: "tunnel",
    price: 5,
    description: "Best for local development & exposing services",
    features: [
      "Custom tunnel subdomain (yourname.gitterm.dev)",
      "Secure public access to local services",
      "Ideal for webhooks, demos, and local testing",
      "Same daily cloud minutes as Free",
      "Cancel anytime",
    ],
    actionLabel: "Start with Tunnel",
  },
  {
    name: "Pro",
    slug: "pro",
    price: 15,
    description: "Full cloud development - no limits",
    features: [
      "Unlimited cloud runtime",
      "Custom subdomain for cloud workspaces",
      "Multi-region deployments (US, EU, Asia)",
      "Priority support",
      "Local tunnels included",
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

const CheckItem = ({ text }: { text: string }) => (
  <div className="flex gap-2">
    <CheckCircle2 size={18} className="my-auto text-green-500 shrink-0" />
    <p className="pt-0.5 text-muted-foreground text-sm">{text}</p>
  </div>
);

function PricingCard({
  plan,
  currentPlan,
  onUpgrade,
  isLoading,
  loadingPlan,
}: {
  plan: PlanTier;
  currentPlan?: UserPlan;
  onUpgrade: (slug: "tunnel" | "pro") => void;
  isLoading: boolean;
  loadingPlan?: "tunnel" | "pro" | null;
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
  const [loadingPlan, setLoadingPlan] = useState<"tunnel" | "pro" | null>(null);
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
      (planParam === "tunnel" || planParam === "pro") &&
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

  const handleUpgrade = async (slug: "tunnel" | "pro") => {
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
              Start free, upgrade when you need more. All plans include access to cloud workspaces
              and local tunnels.
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

          {/* Ideal For Section */}
          <div className="mt-20 grid gap-8 md:grid-cols-2">
            <div className="rounded-lg border border-border p-6 bg-card">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5 text-primary" />
                Tunnel is ideal for
              </h3>
              <p className="text-muted-foreground text-sm">
                Developers who want a reliable <strong>ngrok alternative</strong> with permanent
                URLs and zero setup overhead. Perfect for webhooks, demos, and local testing.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6 bg-card">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Pro is ideal for
              </h3>
              <p className="text-muted-foreground text-sm">
                Developers who live in the cloud and want{" "}
                <strong>fast, always-on environments</strong> with full control and branding. Built
                for professional and freelance workflows.
              </p>
            </div>
          </div>

          {/* FAQ or Additional Info */}
          <div className="mt-20 text-center">
            <h2 className="text-2xl font-bold mb-4">Questions?</h2>
            <p className="text-muted-foreground mb-6">
              Need help choosing the right plan? Check out our docs or reach out.
            </p>
            <div className="flex justify-center gap-4 flex-wrap">
              <Link
                href="https://github.com/OpeOginni/gitterm"
                target="_blank"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                View on GitHub
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

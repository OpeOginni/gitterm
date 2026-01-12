"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  initiateCheckout,
  openCustomerPortal,
  isBillingEnabled,
  authClient,
} from "@/lib/auth-client";
import {
  Check,
  ExternalLink,
  Loader2,
  Sparkles,
  ArrowRight,
  Settings,
  Package,
  Terminal,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

type UserPlan = "free" | "tunnel" | "pro";

interface BillingSectionProps {
  currentPlan: UserPlan;
}

interface PlanConfig {
  name: string;
  description: string;
  price: string;
  period: string;
  features: string[];
  icon: React.ReactNode;
  popular?: boolean;
}

const PLANS: Record<Exclude<UserPlan, "free">, PlanConfig> = {
  tunnel: {
    name: "Tunnel",
    description: "Custom URL for your local tunnels",
    price: "$5",
    period: "/month",
    icon: <Terminal className="h-5 w-5" />,
    features: [
      "Custom tunnel subdomain (yourname.gitterm.dev)",
      "Secure public access to local services",
      "Ideal for webhooks, demos, and local testing",
      "10 sandbox runs / month (same as Free)",
    ],
  },
  pro: {
    name: "Pro",
    description: "Full-featured agentic coding platform",
    price: "$20",
    period: "/month",
    icon: <Sparkles className="h-5 w-5" />,
    popular: true,
    features: [
      "Unlimited projects",
      "100 sandbox runs / month",
      "Max 40 min per run",
      "Bring-your-own inference",
      "Priority queue",
      "Agent memory / project context",
      "Email notifications on run completion",
      "Custom tunnel subdomain included",
    ],
  },
};

interface RunPackConfig {
  runs: number;
  price: string;
  pricePerRun: string;
  slug: "run_pack_50" | "run_pack_100";
}

const RUN_PACKS: RunPackConfig[] = [
  { runs: 50, price: "$15", pricePerRun: "$0.30", slug: "run_pack_50" },
  { runs: 100, price: "$25", pricePerRun: "$0.25", slug: "run_pack_100" },
];

const PLAN_DESCRIPTIONS: Record<UserPlan, string> = {
  free: "10 sandbox runs/month included. Upgrade for more runs and premium features.",
  tunnel: "Custom tunnel subdomain with 10 sandbox runs/month",
  pro: "Full agentic coding with 100 runs/month and all premium features",
};

function PlanCard({
  plan,
  config,
  currentPlan,
  onUpgrade,
  isLoading,
}: {
  plan: Exclude<UserPlan, "free">;
  config: PlanConfig;
  currentPlan: UserPlan;
  onUpgrade: (plan: Exclude<UserPlan, "free">) => void;
  isLoading: boolean;
}) {
  const isCurrentPlan = currentPlan === plan;

  return (
    <Card
      className={`relative flex flex-col ${
        config.popular ? "border-primary/50 shadow-lg shadow-primary/10" : ""
      }`}
    >
      {config.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
        </div>
      )}

      <CardHeader className="text-center pt-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {config.icon}
        </div>
        <CardTitle className="text-xl">{config.name}</CardTitle>
        <CardDescription className="text-xs">{config.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 text-center">
        <div className="mb-6">
          <span className="text-4xl font-bold">{config.price}</span>
          <span className="text-muted-foreground">{config.period}</span>
        </div>

        <ul className="space-y-3 text-left">
          {config.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter>
        {isCurrentPlan ? (
          <Button variant="outline" className="w-full" disabled>
            Current Plan
          </Button>
        ) : (
          <Button className="w-full" onClick={() => onUpgrade(plan)} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Upgrade to {config.name}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function BillingSection({ currentPlan }: BillingSectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const { data: session } = authClient.useSession();
  const router = useRouter();

  // If neither billing nor pricing is enabled, show self-hosted message
  if (!isBillingEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Billing is not enabled for this instance.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You have full access to all features in self-hosted mode.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleUpgrade = async (plan: Exclude<UserPlan, "free">) => {
    if (!isBillingEnabled) {
      // If billing is not enabled, redirect to pricing page
      window.location.href = "/pricing";
      return;
    }

    // Check if user is logged in before checkout
    if (!session?.user) {
      // Redirect to login with plan parameter in redirect URL
      const redirectUrl = `/pricing?plan=${plan}`;
      router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }

    setIsLoading(true);
    try {
      await initiateCheckout(plan);
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    setIsPortalLoading(true);
    try {
      await openCustomerPortal();
    } catch (error) {
      console.error("Failed to open customer portal:", error);
    } finally {
      setIsPortalLoading(false);
    }
  };

  const planConfig = currentPlan !== "free" ? PLANS[currentPlan] : null;

  // For paid subscribers (tunnel or pro), show subscription management
  if (currentPlan === "tunnel" || currentPlan === "pro") {
    return (
      <div className="space-y-6">
        {/* Active Subscription Card */}
        <Card className="border-primary/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {planConfig?.icon}
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {planConfig?.name} Plan
                    <Badge variant="default" className="capitalize">
                      Active
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {planConfig?.price}
                    {planConfig?.period}
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Your plan includes:</p>
              <ul className="space-y-2">
                {planConfig?.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
          <CardFooter className="border-t pt-6">
            <Button
              variant="outline"
              onClick={handleOpenPortal}
              disabled={isPortalLoading}
              className="w-full"
            >
              {isPortalLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Settings className="mr-2 h-4 w-4" />
              )}
              Manage Subscription
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>

        {/* Upgrade to Pro for Tunnel users */}
        {currentPlan === "tunnel" && (
          <Card className="border-dashed border-primary/30">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">Upgrade to Pro</CardTitle>
                  <CardDescription>$20/month</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium mb-2">Everything in Tunnel, plus:</p>
              <ul className="space-y-2">
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>100 sandbox runs / month (10x more)</span>
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Priority queue access</span>
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Agent memory / project context</span>
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>Email notifications on run completion</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="border-t pt-6">
              <Button onClick={() => handleUpgrade("pro")} disabled={isLoading} className="w-full">
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Upgrade to Pro
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Run Packs for paid users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Need more runs?
            </CardTitle>
            <CardDescription>
              {currentPlan === "pro"
                ? "Your Pro plan includes 100 runs/month. Purchase additional run packs anytime."
                : "Your Tunnel plan includes 10 runs/month. Purchase additional run packs anytime."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {RUN_PACKS.map((pack) => (
                <div
                  key={pack.slug}
                  className="flex items-center justify-between p-4 rounded-lg border border-dashed"
                >
                  <div>
                    <p className="font-medium">{pack.runs} Runs</p>
                    <p className="text-sm text-muted-foreground">
                      {pack.price} ({pack.pricePerRun}/run)
                    </p>
                  </div>
                  <Link href="/pricing">
                    <Button size="sm" variant="outline">
                      Buy
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // For free users, show upgrade options
  return (
    <div className="space-y-6">
      {/* Current Plan Display */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Plan</CardTitle>
              <CardDescription>{PLAN_DESCRIPTIONS[currentPlan]}</CardDescription>
            </div>
            <Badge variant="secondary" className="capitalize">
              {currentPlan}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            You have 10 free runs/month. Subscribe to Pro for 100 runs/month and premium features.
          </p>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Link href={"/pricing" as Route}>
            <Button variant="default" className="gap-2">
              <Sparkles className="h-4 w-4" />
              View Pricing
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardFooter>
      </Card>

      {/* Run Packs for Free Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Need more runs?
          </CardTitle>
          <CardDescription>
            Purchase run packs for additional runs beyond your 10 free monthly runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {RUN_PACKS.map((pack) => (
              <div
                key={pack.slug}
                className="flex items-center justify-between p-4 rounded-lg border border-dashed"
              >
                <div>
                  <p className="font-medium">{pack.runs} Runs</p>
                  <p className="text-sm text-muted-foreground">
                    {pack.price} ({pack.pricePerRun}/run)
                  </p>
                </div>
                <Link href="/pricing">
                  <Button size="sm" variant="outline">
                    Buy
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Plan badge for display in navigation/header
 */
export function PlanBadge({ plan }: { plan: UserPlan }) {
  // Don't show badge if pricing is disabled or user is on free plan
  if (!isBillingEnabled || plan === "free") {
    return null;
  }

  const variants: Record<UserPlan, "default" | "secondary" | "outline"> = {
    free: "secondary",
    tunnel: "outline",
    pro: "default",
  };

  return (
    <Badge variant={variants[plan]} className="capitalize text-xs">
      {plan}
    </Badge>
  );
}

/**
 * Simple upgrade prompt component for use throughout the app
 */
export function UpgradePrompt({
  message = "Unlock more features",
  size = "default",
}: {
  message?: string;
  size?: "default" | "compact";
}) {
  const showPricing = isBillingEnabled;

  if (!showPricing) {
    return null;
  }

  if (size === "compact") {
    return (
      <Link
        href={"/pricing" as Route}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Sparkles className="h-3 w-3" />
        {message}
      </Link>
    );
  }

  return (
    <Link href={"/pricing" as Route}>
      <Button variant="outline" size="sm" className="gap-2">
        <Sparkles className="h-4 w-4" />
        {message}
      </Button>
    </Link>
  );
}

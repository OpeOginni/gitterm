"use client";

import { useState } from "react";
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
} from "@/lib/auth-client";
import { Check, ExternalLink, Loader2, Sparkles, Zap, Terminal, ArrowRight } from "lucide-react";
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
    description: "Best for local development & exposing services",
    price: "$5",
    period: "/month",
    icon: <Terminal className="h-5 w-5" />,
    features: [
      "Custom tunnel subdomain (yourname.gitterm.dev)",
      "Secure public access to local services",
      "Ideal for webhooks, demos, and local testing",
      "Same daily cloud minutes as Free",
    ],
  },
  pro: {
    name: "Pro",
    description: "Full cloud development - no limits",
    price: "$15",
    period: "/month",
    icon: <Sparkles className="h-5 w-5" />,
    popular: true,
    features: [
      "Unlimited cloud runtime",
      "Custom subdomain for cloud workspaces",
      "Multi-region deployments (US, EU, Asia)",
      "Priority support",
      "Local tunnels included",
    ],
  },
};

const PLAN_DESCRIPTIONS: Record<UserPlan, string> = {
  free: "60 minutes/day of cloud runtime with auto-generated subdomains",
  tunnel: "Custom subdomain for local development with secure public access",
  pro: "Unlimited cloud runtime with custom subdomains and multi-region support",
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
  const planOrder: UserPlan[] = ["free", "tunnel", "pro"];
  const isDowngrade = planOrder.indexOf(currentPlan) > planOrder.indexOf(plan);

  return (
    <Card
      className={`relative flex flex-col ${
        config.popular
          ? "border-primary/50 shadow-lg shadow-primary/10"
          : ""
      }`}
    >
      {config.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground">
            Most Popular
          </Badge>
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
        ) : isDowngrade ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => openCustomerPortal()}
          >
            Manage Subscription
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={() => onUpgrade(plan)}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Upgrade to {config.name}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function BillingSection({ currentPlan }: BillingSectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const showPricing = isBillingEnabled;

  // If neither billing nor pricing is enabled, show self-hosted message
  if (!isBillingEnabled && !showPricing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>
            Billing is not enabled for this instance.
          </CardDescription>
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
    setIsLoading(true);
    try {
      await initiateCheckout(plan);
    } catch (error) {
      console.error("Checkout failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Plan Display */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Plan</CardTitle>
              <CardDescription>
                {PLAN_DESCRIPTIONS[currentPlan]}
              </CardDescription>
            </div>
            <Badge
              variant={currentPlan === "free" ? "secondary" : "default"}
              className="capitalize"
            >
              {currentPlan}
            </Badge>
          </div>
        </CardHeader>
        <CardFooter className="flex gap-3">
          {currentPlan !== "free" && isBillingEnabled && (
            <Button variant="outline" onClick={() => openCustomerPortal()}>
              Manage Subscription
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          )}
          {currentPlan === "free" && showPricing && (
            <Link href={"/pricing" as Route}>
              <Button variant="default" className="gap-2">
                <Sparkles className="h-4 w-4" />
                View Upgrade Options
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </CardFooter>
      </Card>

      {/* Plan Cards - only show if billing is enabled */}
      {isBillingEnabled && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Available Plans</h3>
            {showPricing && (
              <Link href={"/pricing" as Route} className="text-sm text-primary hover:underline">
                View all plans
              </Link>
            )}
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {(Object.entries(PLANS) as [Exclude<UserPlan, "free">, PlanConfig][]).map(
              ([plan, config]) => (
                <PlanCard
                  key={plan}
                  plan={plan}
                  config={config}
                  currentPlan={currentPlan}
                  onUpgrade={handleUpgrade}
                  isLoading={isLoading}
                />
              )
            )}
          </div>
        </div>
      )}

      {/* If only pricing is enabled (not billing), show a simple upgrade CTA */}
      {!isBillingEnabled && showPricing && currentPlan === "free" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Unlock More Features
            </CardTitle>
            <CardDescription>
              Get custom subdomains, unlimited cloud runtime, and more.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href={"/pricing" as Route}>
              <Button className="gap-2">
                View Pricing
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

/**
 * Plan badge for display in navigation/header
 */
export function PlanBadge({ plan }: { plan: UserPlan }) {
  const showPricing = isBillingEnabled;
  
  // Don't show badge if pricing is disabled or user is on free plan
  if (!showPricing || plan === "free") {
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
  size = "default" 
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

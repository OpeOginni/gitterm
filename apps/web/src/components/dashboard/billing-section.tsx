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
import { Check, ExternalLink, Loader2, Sparkles, Zap, Building2 } from "lucide-react";

type UserPlan = "free" | "tunnel" | "pro" | "enterprise";

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
  bestValue?: boolean;
}

const PLANS: Record<Exclude<UserPlan, "free">, PlanConfig> = {
  tunnel: {
    name: "Tunnel",
    description: "Custom subdomain for local development",
    price: "$5",
    period: "/month",
    icon: <Zap className="h-5 w-5" />,
    features: [
      "Custom tunnel subdomain",
      "Local development access",
      "60 min/day cloud hosting",
      "Community support",
    ],
  },
  pro: {
    name: "Pro",
    description: "Full access with unlimited cloud hosting",
    price: "$15",
    period: "/month",
    icon: <Sparkles className="h-5 w-5" />,
    popular: true,
    features: [
      "Everything in Tunnel",
      "Custom cloud subdomain",
      "Unlimited cloud hosting",
      "Multi-region support",
      "Priority support",
    ],
  },
  enterprise: {
    name: "Enterprise",
    description: "For teams and organizations",
    price: "$49",
    period: "/month",
    icon: <Building2 className="h-5 w-5" />,
    bestValue: true,
    features: [
      "Everything in Pro",
      "Dedicated support channel",
      "Custom integrations",
      "SLA guarantee",
      "Team management",
    ],
  },
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
  const planOrder: UserPlan[] = ["free", "tunnel", "pro", "enterprise"];
  const isDowngrade = planOrder.indexOf(currentPlan) > planOrder.indexOf(plan);

  return (
    <Card
      className={`relative ${
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
      {config.bestValue && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="secondary">Best Value</Badge>
        </div>
      )}

      <CardHeader className="text-center pt-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {config.icon}
        </div>
        <CardTitle className="text-xl">{config.name}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>

      <CardContent className="text-center">
        <div className="mb-6">
          <span className="text-4xl font-bold">{config.price}</span>
          <span className="text-muted-foreground">{config.period}</span>
        </div>

        <ul className="space-y-3 text-left">
          {config.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0" />
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

  if (!isBillingEnabled) {
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
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>
                Manage your subscription and billing
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
        {currentPlan !== "free" && (
          <CardFooter>
            <Button variant="outline" onClick={() => openCustomerPortal()}>
              Manage Subscription
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Plan Cards */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Available Plans</h3>
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
    </div>
  );
}

/**
 * Plan badge for display in navigation/header
 */
export function PlanBadge({ plan }: { plan: UserPlan }) {
  if (!isBillingEnabled || plan === "free") {
    return null;
  }

  const variants: Record<UserPlan, "default" | "secondary" | "outline"> = {
    free: "secondary",
    tunnel: "outline",
    pro: "default",
    enterprise: "default",
  };

  return (
    <Badge variant={variants[plan]} className="capitalize text-xs">
      {plan}
    </Badge>
  );
}

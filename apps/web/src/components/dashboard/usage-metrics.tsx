"use client";

import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Clock, TrendingUp, Zap } from "lucide-react";

export function UsageMetrics() {
  const { data, isLoading } = useQuery(trpc.workspace.getDailyUsage.queryOptions());

  if (isLoading) {
    return null; // Handled by Suspense
  }

  const usage = data || { minutesUsed: 0, minutesRemaining: 60, dailyLimit: 60 };
  const usagePercent = (usage.minutesUsed / usage.dailyLimit) * 100;

  const metrics = [
    {
      title: "Daily Usage",
      value: `${usage.minutesUsed} min`,
      subtitle: `of ${usage.dailyLimit} min`,
      icon: Clock,
      color: "text-blue-500",
    },
    {
      title: "Remaining",
      value: `${usage.minutesRemaining} min`,
      subtitle: "Available today",
      icon: Zap,
      color: "text-green-500",
    },
    {
      title: "Usage",
      value: `${Math.round(usagePercent)}%`,
      subtitle: "Quota used",
      icon: TrendingUp,
      color: usagePercent > 80 ? "text-red-500" : "text-yellow-500",
    },
  ];

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {metric.title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${metric.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metric.value}</div>
                <p className="text-xs text-muted-foreground">
                  {metric.subtitle}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Quota Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={usagePercent} className="h-2" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{usage.minutesUsed} minutes used</span>
            <span>{usage.minutesRemaining} minutes remaining</span>
          </div>
          {usage.minutesRemaining === 0 && (
            <p className="text-sm text-destructive">
              Daily limit reached. Quota resets at midnight UTC.
            </p>
          )}
          {usage.minutesRemaining > 0 && usage.minutesRemaining < 15 && (
            <p className="text-sm text-yellow-600">
              Running low on quota. Consider wrapping up your work soon.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}


"use client"

import type React from "react"

import { useQuery } from "@tanstack/react-query"
import { trpc } from "@/utils/trpc"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Clock, Infinity as InfinityIcon, TrendingUp, Zap } from "lucide-react"

export function UsageMetrics() {
  const { data, isLoading } = useQuery(trpc.workspace.getDailyUsage.queryOptions())

  if (isLoading) {
    return null
  }

  const usage = data || { minutesUsed: 0, minutesRemaining: 60, dailyLimit: 60 }
  
  // Check if we're in unlimited mode (self-hosted or paid plan)
  // Infinity becomes null when serialized to JSON
  const isUnlimited = usage.minutesRemaining === null || usage.dailyLimit === null || 
                      usage.minutesRemaining === Infinity || usage.dailyLimit === Infinity
  
  const usagePercent = isUnlimited ? 0 : (usage.minutesUsed / usage.dailyLimit) * 100

  // In unlimited mode, show a simplified view
  if (isUnlimited) {
    return (
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="border-border/50 bg-card/50 overflow-hidden group hover:border-accent/30 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Usage Today</CardTitle>
            <div className="p-2 rounded-lg bg-secondary/50">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{usage.minutesUsed} min</div>
            <p className="text-xs text-muted-foreground mt-1">Minutes used today</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 overflow-hidden group hover:border-accent/30 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Quota</CardTitle>
            <div className="p-2 rounded-lg bg-accent/10 group-hover:bg-accent/20">
              <InfinityIcon className="h-4 w-4 text-accent" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-primary">Unlimited</div>
            <p className="text-xs text-muted-foreground mt-1">No usage limits</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const metrics = [
    {
      title: "Daily Usage",
      value: `${usage.minutesUsed} min`,
      subtitle: `of ${usage.dailyLimit} min`,
      icon: Clock,
      accent: false,
    },
    {
      title: "Remaining",
      value: `${usage.minutesRemaining} min`,
      subtitle: "Available today",
      icon: Zap,
      accent: false,
    },
    {
      title: "Usage",
      value: `${Math.round(usagePercent)}%`,
      subtitle: "Quota used",
      icon: TrendingUp,
      warning: usagePercent > 80,
    },
  ]

  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <Card
              key={metric.title}
              className="border-border/50 bg-card/50 overflow-hidden group hover:border-accent/30 transition-colors"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{metric.title}</CardTitle>
                <div
                  className={`p-2 rounded-lg transition-colors ${
                    metric.accent
                      ? "bg-accent/10 group-hover:bg-accent/20"
                      : metric.warning
                        ? "bg-destructive/10"
                        : "bg-secondary/50"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${
                      metric.accent
                        ? "text-accent"
                        : metric.warning
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-semibold ${
                    metric.accent ? "text-primary" : metric.warning ? "text-destructive" : ""
                  }`}
                >
                  {metric.value}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{metric.subtitle}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Daily Quota Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Progress
              value={usagePercent}
              className="h-2 bg-secondary/50"
              style={
                {
                  // @ts-ignore
                  "--progress-foreground": usagePercent > 80 ? "var(--destructive)" : "var(--accent)",
                } as React.CSSProperties
              }
            />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{usage.minutesUsed} minutes used</span>
              <span>{usage.minutesRemaining} minutes remaining</span>
            </div>
          </div>
          {usage.minutesRemaining === 0 && (
            <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20">
              Daily limit reached. Quota resets at midnight UTC.
            </p>
          )}
          {usage.minutesRemaining > 0 && usage.minutesRemaining < 15 && (
            <p className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg border border-border/50">
              Running low on quota. Consider wrapping up your work soon.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

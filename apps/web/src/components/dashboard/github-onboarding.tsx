"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, GitCommitHorizontal, Loader2, ShieldCheck, X } from "lucide-react";
import { GitHub as Github } from "@/components/logos/Github";
import { Button } from "@/components/ui/button";
import { trpc } from "@/utils/trpc";
import { track, AnalyticsEvent } from "@/lib/analytics";
import env from "@gitterm/env/web";

const GITHUB_APP_NAME = env.NEXT_PUBLIC_GITHUB_APP_NAME || "gitterm-dev";
const DISMISS_KEY = "gitterm:github-onboarding-dismissed";

const STEPS = [
  { icon: Github, label: "Connect once", desc: "Install the GitHub App" },
  {
    icon: GitCommitHorizontal,
    label: "Clone & commit",
    desc: "Push straight from the terminal",
  },
  {
    icon: ShieldCheck,
    label: "Stay secure",
    desc: "Grant access to only the repos you choose",
  },
] as const;

export function GitHubOnboarding() {
  const [dismissed, setDismissed] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  const { data, isLoading } = useQuery(trpc.workspace.listUserInstallations.queryOptions());

  const hasIntegration = (data?.installations?.length ?? 0) > 0;

  // Read persisted dismissal on mount (avoids SSR/hydration flash).
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const shouldShow = !isLoading && !hasIntegration && !dismissed;

  useEffect(() => {
    if (shouldShow) track(AnalyticsEvent.GitHubOnboardingShown);
  }, [shouldShow]);

  if (!shouldShow) return null;

  const handleConnect = () => {
    track(AnalyticsEvent.GitHubOnboardingConnect);
    setIsConnecting(true);
    const redirectUrl = `${env.NEXT_PUBLIC_SERVER_URL}/api/github/callback`;
    window.location.href = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new?redirect_uri=${encodeURIComponent(redirectUrl)}`;
  };

  const handleDismiss = () => {
    track(AnalyticsEvent.GitHubOnboardingDismissed);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <section
      aria-label="Connect GitHub"
      className="rise scanlines relative overflow-hidden rounded-2xl border border-primary/20 bg-card"
    >
      {/* Atmospheric gold mesh */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(120% 140% at 88% -10%, rgba(200,164,78,0.16) 0%, transparent 55%), radial-gradient(90% 120% at 0% 120%, rgba(200,164,78,0.06) 0%, transparent 60%)",
        }}
      />

      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative grid gap-7 p-6 sm:p-8 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        {/* Left: pitch */}
        <div>
          <span className="marker">GT / GET STARTED</span>

          <h2 className="mt-3 text-balance text-xl font-bold tracking-tight text-white sm:text-2xl">
            Build from your repo, <span className="text-primary">not an empty shell.</span>
          </h2>

          <p className="mt-2.5 max-w-md text-sm leading-relaxed text-white/45">
            Connect GitHub so every workspace can clone your repositories, commit, push, and open
            pull requests
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="gap-2 bg-primary font-mono text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground hover:bg-primary/85"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecting…
                </>
              ) : (
                <>
                  <Github fill="#000000" className="h-4 w-4" />
                  Connect GitHub
                </>
              )}
            </Button>

            <button
              onClick={handleDismiss}
              className="inline-flex items-center gap-1 self-center text-xs font-medium text-white/40 transition-colors hover:text-white/70"
            >
              Start without GitHub
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Right: stepped flow */}
        <ol className="relative space-y-2.5">
          {STEPS.map((step, i) => (
            <li
              key={step.label}
              className="rise flex items-center gap-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 transition-colors hover:border-primary/20"
              style={{ animationDelay: `${0.08 * (i + 1)}s` }}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.08]">
                <step.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/85">{step.label}</p>
                <p className="text-xs text-white/40">{step.desc}</p>
              </div>
              <span className="ml-auto font-mono text-[10px] tracking-[0.2em] text-white/20">
                0{i + 1}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAnonTryEnabled } from "@gitterm/env/web";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Loader2,
  Copy,
  ExternalLink,
  Square,
  Globe,
  Terminal,
  Monitor,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { GitHub } from "@/components/logos/Github";
import { trpc } from "@/utils/trpc";
import { getWorkspaceUrl } from "@/lib/utils";
import { track, AnalyticsEvent } from "@/lib/analytics";
import { toast } from "sonner";
import {
  FormCard,
  FormCardBody,
  FormCardFooter,
  FormCardHeader,
  FormCardStatus,
} from "@/components/ui/form-card";

const clouds = [
  { src: "/E2B.svg", label: "E2B" },
  { src: "/daytona.svg", label: "Daytona" },
  { src: "/railway.svg", label: "Railway" },
  { src: "/ECS.svg", label: "AWS" },
  { src: "/cloudflare.svg", label: "Cloudflare" },
];

interface AnonResult {
  workspaceId: string;
  userId: string;
  subdomain: string;
  serverUsername: string;
  serverPassword: string;
  startedAt: string;
  expiresAt: string;
  expiresInSeconds: number;
}

function copyText(value: string, message: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(message),
    () => toast.error("Couldn't copy"),
  );
}

export function HeroSection() {
  const [repo, setRepo] = useState("");
  const [result, setResult] = useState<AnonResult | null>(null);

  const launchMutation = useMutation(trpc.anon.tryGitterm.mutationOptions());
  const killMutation = useMutation(trpc.anon.killAnonWorkspace.mutationOptions());
  const anonEnabled = isAnonTryEnabled();

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (launchMutation.isPending) return;

    const trimmed = repo.trim();
    const ok =
      /^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(trimmed) ||
      /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/i.test(trimmed);
    if (!ok) {
      toast.error("Paste a public GitHub repo URL or owner/name (e.g. vercel/next.js).");
      return;
    }

    try {
      const data = (await launchMutation.mutateAsync({
        repo: trimmed,
        agent: "app",
      })) as AnonResult;
      setResult(data);
      track(AnalyticsEvent.AnonTryLaunch, { agent: "app", provider: "e2b" });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleReset() {
    if (result?.workspaceId) {
      await killMutation.mutateAsync({ workspaceId: result.workspaceId }).catch(() => undefined);
      track(AnalyticsEvent.AnonTryKill);
    }
    setResult(null);
    launchMutation.reset();
    setRepo("");
  }

  return (
    <section className="relative overflow-hidden pt-24 pb-14 sm:pt-32 sm:pb-20 md:pt-44 md:pb-24">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[700px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.08),transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[920px] px-4 text-center sm:px-6">
        <div
          className="rise mb-8 flex items-center justify-center gap-3"
          style={{ animationDelay: "0ms" }}
        >
          <span className="h-px w-10 bg-white/[0.08]" />
          <span className="marker">Cloud workspaces for coding agents</span>
          <span className="h-px w-10 bg-white/[0.08]" />
        </div>

        <h1
          className={`rise font-display font-light leading-[1] tracking-tight text-white sm:leading-[0.98] ${
            anonEnabled ? "text-[clamp(2rem,7vw,4.8rem)]" : "text-[clamp(2.4rem,9vw,6.5rem)]"
          }`}
          style={{ animationDelay: "80ms" }}
        >
          Run your coding agent
          <br />
          in the <span className="font-display-italic text-primary">cloud.</span>
        </h1>

        <p
          className="rise mx-auto mt-5 max-w-xl font-sans text-[15px] leading-[1.6] text-white/55 sm:mt-7 sm:text-[17px] sm:leading-[1.65]"
          style={{ animationDelay: "180ms" }}
        >
          {anonEnabled ? (
            <>
              Try a public GitHub repo in a 10-minute{" "}
              <Link
                href="https://opencode.ai/"
                target="_blank"
                className="text-white/85 underline decoration-white/20 underline-offset-[5px] transition hover:decoration-primary"
              >
                OpenCode
              </Link>{" "}
              sandbox. Sign in for persistent workspaces, your own keys, and cloud choice.
            </>
          ) : (
            "Sign in for persistent workspaces, your own keys, and cloud choice."
          )}
        </p>

        <div
          className="rise mx-auto mt-8 max-w-2xl text-left sm:mt-11"
          style={{ animationDelay: "260ms" }}
        >
          {anonEnabled ? (
            <>
              {result ? (
                <ResultCard
                  result={result}
                  onReset={handleReset}
                  isResetting={killMutation.isPending}
                />
              ) : (
                <LaunchForm
                  repo={repo}
                  setRepo={setRepo}
                  isPending={launchMutation.isPending}
                  error={launchMutation.error?.message}
                  onSubmit={handleLaunch}
                />
              )}

              {!result && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12.5px] text-white/40">
                  <span>Want more workspaces, persistence, SSH, and your own keys?</span>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1 font-mono uppercase tracking-[0.18em] text-primary/90 underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                  >
                    Sign in →
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-7 py-6 text-center">
              <Link href="/dashboard">
                <Button className="group h-12 bg-primary px-7 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-primary-foreground hover:bg-primary/90">
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1" />
                </Button>
              </Link>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-white/35">
                bring your own keys · pick your cloud · no card required
              </span>
            </div>
          )}
        </div>

        <div className="mt-14 text-left sm:mt-20">
          <div className="hairline" />

          <div className="py-7">
            <div className="mb-4 flex items-baseline justify-between">
              <span className="marker">
                <span className="text-white/55">01</span>
                <span className="mx-2 text-white/20">/</span>
                Run on
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/25">
                pick your cloud
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 sm:gap-x-9">
              {clouds.map((c) => (
                <div
                  key={c.label}
                  className="group flex items-center gap-2 text-white/60 transition-colors hover:text-white/90"
                >
                  <Image
                    src={c.src}
                    alt={c.label}
                    width={18}
                    height={18}
                    className="h-[18px] w-[18px] opacity-80 transition-opacity group-hover:opacity-100"
                  />
                  <span className="font-sans text-[13.5px]">{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hairline" />

          <div className="py-7">
            <div className="mb-4 flex items-baseline justify-between">
              <span className="marker">
                <span className="text-white/55">02</span>
                <span className="mx-2 text-white/20">/</span>
                Powered by
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/25">
                more soon
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 text-white/85">
              <Image
                src="/opencode.svg"
                alt="OpenCode"
                width={20}
                height={20}
                className="h-5 w-5"
              />
              <span className="font-sans text-[14px]">OpenCode</span>
              <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary/85">
                live
              </span>
            </div>
          </div>

          <div className="hairline" />
        </div>
      </div>
    </section>
  );
}

/* ─── Form view ───────────────────────────────────────────────────────── */

function LaunchForm({
  repo,
  setRepo,
  isPending,
  error,
  onSubmit,
}: {
  repo: string;
  setRepo: (v: string) => void;
  isPending: boolean;
  error?: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <FormCard className="scanlines">
      <form onSubmit={onSubmit}>
        <FormCardHeader>
          <span>Try it now</span>
          <FormCardStatus tone="ready">ready</FormCardStatus>
        </FormCardHeader>

        <FormCardBody className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
          <label className="flex flex-1 items-center gap-3 rounded-lg bg-input/70 px-3.5 transition-colors focus-within:bg-input focus-within:ring-2 focus-within:ring-ring/40">
            <GitHub className="h-4 w-4 shrink-0 opacity-60" />
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="github.com/your-org/your-repo"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={isPending}
              className="h-10 w-full bg-transparent font-mono text-sm text-white/90 placeholder:text-white/40 focus:outline-none disabled:opacity-50"
            />
          </label>

          <Button
            type="submit"
            disabled={isPending}
            className="group h-10 shrink-0 px-5 font-mono text-[12px] font-bold uppercase tracking-[0.18em]"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Booting
              </>
            ) : (
              <>
                Launch
                <ArrowRight className="cta-arrow-nudge ml-2 h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </FormCardBody>

        {error ? (
          <div className="border-t border-destructive/30 bg-destructive/[0.06] px-4 py-2.5 text-[12.5px] text-destructive/90">
            {error}
          </div>
        ) : null}

        <FormCardFooter>
          <span className="truncate">10-min workspace · public repos · no signup</span>
          <span className="flex shrink-0 items-center gap-1.5 text-white/55">
            <Image src="/E2B.svg" alt="" width={11} height={11} />
            sponsored by E2B
          </span>
        </FormCardFooter>
      </form>
    </FormCard>
  );
}

/* ─── Result view ─────────────────────────────────────────────────────── */

function ResultCard({
  result,
  onReset,
  isResetting,
}: {
  result: AnonResult;
  onReset: () => void;
  isResetting?: boolean;
}) {
  const url = useMemo(() => getWorkspaceUrl(result.subdomain), [result.subdomain]);
  const attachCommand = useMemo(
    () => `opencode attach ${url} -p ${result.serverPassword}`,
    [url, result.serverPassword],
  );
  const attachDisplay = useMemo(() => `opencode attach ${url} -p ••••`, [url]);
  const [now, setNow] = useState(() => Date.now());
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const expiresAtMs = useMemo(() => new Date(result.expiresAt).getTime(), [result.expiresAt]);
  const remainingMs = Math.max(0, expiresAtMs - now);
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);
  const expired = remainingMs === 0;

  function handleOpen() {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <FormCard tone="success" className="scanlines">
      <FormCardHeader>
        <span>Live sandbox</span>
        <FormCardStatus tone={expired ? "expired" : "ready"}>
          {expired ? "expired" : "ready"}
        </FormCardStatus>
      </FormCardHeader>

      <div className="space-y-4 p-4 pt-3 sm:space-y-5 sm:p-5 sm:pt-3">
        {/* Workspace URL */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
            Workspace URL
          </p>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-input/70 px-3.5 py-2.5">
            <span className="flex-1 truncate font-mono text-[13.5px] text-white/85">{url}</span>
            <button
              type="button"
              onClick={() => copyText(url, "URL copied")}
              className="text-white/40 transition-colors hover:text-white/80"
              aria-label="Copy URL"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Credentials */}
        <div>
          <div className="mb-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
              Credentials
            </p>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-3 rounded-lg bg-input/70 px-3.5 py-2">
              <span className="w-[72px] shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                Username
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-white/85">
                {result.serverUsername}
              </span>
              <button
                type="button"
                onClick={() => copyText(result.serverUsername, "Username copied")}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-white/40 transition-colors hover:text-white/80"
                aria-label="Copy username"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-input/70 px-3.5 py-2">
              <span className="w-[72px] shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                Password
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-white/85">
                <span className="sm:hidden">••••••••••••</span>
                <span className="hidden sm:inline">
                  {showPassword ? result.serverPassword : "••••••••••••"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="hidden h-7 w-7 shrink-0 items-center justify-center text-white/40 transition-colors hover:text-white/80 sm:inline-flex"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => copyText(result.serverPassword, "Password copied")}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-white/40 transition-colors hover:text-white/80"
                aria-label="Copy password"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Connect options */}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
              How to connect
            </span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <div className="divide-y divide-white/[0.05] overflow-hidden rounded-lg bg-input/40">
            {/* Web UI */}
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
                <Globe className="h-3.5 w-3.5 text-white/60" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white/85">Browser</p>
                <p className="text-[11.5px] text-white/40">Open the workspace.</p>
              </div>
              <button
                type="button"
                onClick={handleOpen}
                disabled={expired}
                className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary transition-colors hover:border-primary/50 hover:bg-primary/15 disabled:opacity-40"
              >
                Open
                <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>

            {/* OpenCode CLI */}
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
                <Terminal className="h-3.5 w-3.5 text-white/60" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white/85">CLI</p>
                <p className="truncate font-mono text-[11.5px] text-white/40">{attachDisplay}</p>
              </div>
              <button
                type="button"
                onClick={() => copyText(attachCommand, "Command copied")}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/20 hover:text-white"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>

            {/* OpenCode Desktop */}
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
                <Monitor className="h-3.5 w-3.5 text-white/60" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white/85">Desktop</p>
                <p className="text-[11.5px] text-white/40">Use the credentials above.</p>
              </div>
            </div>
          </div>
        </div>

        {/* New session */}
        <Button
          type="button"
          variant="outline"
          disabled={isResetting}
          onClick={onReset}
          className="h-10 w-full border-white/[0.1] bg-transparent font-mono text-[11px] uppercase tracking-[0.18em] text-white/60 hover:border-white/30 hover:text-white disabled:opacity-40"
        >
          {isResetting ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Square className="mr-2 h-3 w-3 fill-current" />
          )}
          {isResetting ? "Stopping..." : "Stop sandbox"}
        </Button>
      </div>

      <FormCardFooter>
        <span className="truncate">
          {expired
            ? "session expired. Sign in to keep going."
            : "sign in for persistent workspaces"}
        </span>
        {!expired && (
          <span className="flex shrink-0 items-center gap-1.5 text-primary/80">
            {String(remainingMin).padStart(2, "0")}:{String(remainingSec).padStart(2, "0")}
          </span>
        )}
      </FormCardFooter>
    </FormCard>
  );
}

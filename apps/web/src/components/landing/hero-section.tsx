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
import { getWorkspaceProjectPath, getWorkspaceUrl } from "@/lib/utils";
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
  { src: "/ascii.svg", label: "Ascii" },
  { src: "/vercel.svg", label: "Vercel" },
  { src: "/exe.png", label: "exe.dev" },
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

// Prefilled so trying GitTerm is one click, not a decision.
const DEFAULT_REPO = "anomalyco/opencode";

export function HeroSection() {
  const [repo, setRepo] = useState(DEFAULT_REPO);
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
    setRepo(DEFAULT_REPO);
  }

  return (
    <section className="relative overflow-hidden pt-14 pb-16 sm:pb-20">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[700px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(200,164,78,0.08),transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[920px] px-4 text-center sm:px-6 sm:pt-[clamp(7rem,18svh,11rem)]">
        <div className="flex min-h-[42svh] flex-col justify-center sm:min-h-0">
          <h1
            className={`rise font-display text-balance font-normal leading-[0.94] tracking-[-0.045em] text-white ${
              anonEnabled
                ? "text-[clamp(2.35rem,11vw,4.8rem)]"
                : "text-[clamp(2.55rem,12vw,6.5rem)]"
            }`}
            style={{ animationDelay: "80ms" }}
          >
            Cloud workspaces
            <br />
            for coding <span className="font-display-accent text-primary">agents.</span>
          </h1>

          <p
            className="rise mx-auto mt-5 max-w-[34rem] text-balance font-sans text-[15px] leading-[1.6] text-fg-3 sm:mt-6 sm:text-[17px] sm:leading-[1.65]"
            style={{ animationDelay: "180ms" }}
          >
            Heavy runs and throwaway sandboxes, on any cloud you pick. Your keys. Open source.
          </p>
        </div>

        <div
          className="rise mx-auto mt-5 w-full max-w-[760px] text-left sm:mt-8"
          style={{ animationDelay: "260ms" }}
        >
          {anonEnabled ? (
            <>
              {result ? (
                <ResultCard
                  result={result}
                  repo={repo}
                  onReset={handleReset}
                  isResetting={killMutation.isPending}
                />
              ) : (
                <LaunchForm
                  repo={repo}
                  setRepo={setRepo}
                  isPending={launchMutation.isPending}
                  error={launchMutation.error?.message}
                  isTrialLimit={launchMutation.error?.data?.code === "TOO_MANY_REQUESTS"}
                  onSubmit={handleLaunch}
                />
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
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-fg-4">
                no card required
              </span>
            </div>
          )}
        </div>

        <div className="mt-14 text-left sm:mt-20">
          <div className="hairline" />

          <div className="py-9">
            <div className="mb-5 flex items-center justify-center gap-3">
              <span className="h-px w-6 bg-line-2" />
              <span className="marker">Runs Everywhere</span>
              <span className="h-px w-6 bg-line-2" />
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-6 lg:relative lg:left-1/2 lg:flex lg:w-[min(1120px,calc(100vw-3rem))] lg:-translate-x-1/2 lg:items-center lg:justify-between lg:gap-0">
              {clouds.map((c) => (
                <div
                  key={c.label}
                  className="group flex min-w-0 flex-col items-center gap-2.5 text-center text-fg-2 transition-colors hover:text-fg lg:flex-row lg:gap-3 lg:text-left"
                >
                  <Image
                    src={c.src}
                    alt={c.label}
                    width={30}
                    height={30}
                    className="h-[30px] w-[30px] object-contain opacity-90 transition-opacity group-hover:opacity-100"
                  />
                  <span className="truncate font-sans text-[13px] font-medium lg:text-[15px]">
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="hairline" />

          <div className="py-9">
            <div className="mb-5 flex items-center justify-center gap-3">
              <span className="h-px w-6 bg-line-2" />
              <span className="marker">Agents Supported</span>
              <span className="h-px w-6 bg-line-2" />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:gap-x-14">
              <div className="flex items-center gap-3 text-fg">
                <Image
                  src="/opencode.svg"
                  alt="OpenCode"
                  width={30}
                  height={30}
                  className="h-[30px] w-[30px]"
                />
                <span className="font-sans text-[16px] font-medium">OpenCode</span>
              </div>
              <div className="flex items-center gap-3 text-fg">
                <Image
                  src="/t3.svg"
                  alt="T3 Code"
                  width={30}
                  height={30}
                  className="h-[30px] w-[30px]"
                />
                <span className="font-sans text-[16px] font-medium">T3 Code</span>
              </div>
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
  isTrialLimit,
  onSubmit,
}: {
  repo: string;
  setRepo: (v: string) => void;
  isPending: boolean;
  error?: string;
  isTrialLimit: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div>
      <FormCard className="group/launcher overflow-visible rounded-none border-0 bg-transparent shadow-none">
        <form onSubmit={onSubmit}>
          <FormCardBody className="flex flex-col items-stretch gap-2 p-0 sm:flex-row sm:items-center">
            <label className="flex min-w-0 flex-1 cursor-text items-center gap-3 rounded-[10px] bg-fill px-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-fill focus-within:bg-fill focus-within:shadow-[inset_0_0_0_1px_rgba(200,164,78,0.55),0_0_0_3px_rgba(200,164,78,0.07)] sm:px-4">
              <GitHub className="h-[18px] w-[18px] shrink-0 text-fg-3 transition-colors group-focus-within/launcher:text-fg" />
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repository"
                aria-label="GitHub repository"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={isPending}
                className="h-14 min-w-0 w-full bg-transparent font-mono text-[14px] tracking-[-0.01em] text-fg placeholder:text-fg-4 focus:outline-none disabled:opacity-50"
              />
            </label>

            <Button
              type="submit"
              disabled={isPending}
              className="group/button h-10 shrink-0 self-center rounded-lg px-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] sm:w-[126px]"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Booting
                </>
              ) : (
                <>
                  Launch Now
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover/button:translate-x-1" />
                </>
              )}
            </Button>
          </FormCardBody>

          <div
            aria-live="polite"
            className={`mt-2 flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-center text-[12.5px] transition-colors ${
              isTrialLimit
                ? "bg-primary/[0.07]"
                : error
                  ? "bg-destructive/[0.06]"
                  : "bg-transparent"
            }`}
          >
            {isTrialLimit ? (
              <p className="text-fg-3">
                Want to create more workspaces?{" "}
                <Link
                  href="/login?redirect=/dashboard"
                  className="font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary/80 hover:decoration-primary"
                >
                  Sign up →
                </Link>
              </p>
            ) : error ? (
              <p className="text-destructive/90">{error}</p>
            ) : (
              <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-fg-4">
                10-minute sandbox · public repositories
              </p>
            )}
          </div>
        </form>
      </FormCard>

      <a
        href="https://e2b.dev"
        target="_blank"
        rel="noreferrer"
        className="mx-auto mt-3 flex w-fit items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-fg-4 transition-colors hover:text-fg-3"
      >
        <Image src="/E2B.svg" alt="" width={13} height={14} className="h-3.5 w-auto opacity-60" />
        <span>Sponsored by E2B</span>
      </a>
    </div>
  );
}

/* ─── Result view ─────────────────────────────────────────────────────── */

function ResultCard({
  result,
  repo,
  onReset,
  isResetting,
}: {
  result: AnonResult;
  repo: string;
  onReset: () => void;
  isResetting?: boolean;
}) {
  const url = useMemo(() => getWorkspaceUrl(result.subdomain), [result.subdomain]);
  // Anon sandboxes always run on E2B; OpenCode expands ~/ to the sandbox home.
  const projectPath = useMemo(() => getWorkspaceProjectPath("e2b", repo.trim()), [repo]);
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
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4">
            Workspace URL
          </p>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-input/70 px-3.5 py-2.5">
            <span className="flex-1 truncate font-mono text-[13.5px] text-fg">{url}</span>
            <button
              type="button"
              onClick={() => copyText(url, "URL copied")}
              className="text-fg-4 transition-colors hover:text-fg"
              aria-label="Copy URL"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Credentials */}
        <div>
          <div className="mb-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4">
              Credentials
            </p>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-3 rounded-lg bg-input/70 px-3.5 py-2">
              <span className="w-[72px] shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-4">
                Username
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">
                {result.serverUsername}
              </span>
              <button
                type="button"
                onClick={() => copyText(result.serverUsername, "Username copied")}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 transition-colors hover:text-fg"
                aria-label="Copy username"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-input/70 px-3.5 py-2">
              <span className="w-[72px] shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-4">
                Password
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">
                <span className="sm:hidden">••••••••••••</span>
                <span className="hidden sm:inline">
                  {showPassword ? result.serverPassword : "••••••••••••"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="hidden h-7 w-7 shrink-0 items-center justify-center text-fg-4 transition-colors hover:text-fg sm:inline-flex"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => copyText(result.serverPassword, "Password copied")}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 transition-colors hover:text-fg"
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
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4">
              How to connect
            </span>
            <span className="h-px flex-1 bg-fill-2" />
          </div>

          <div className="divide-y divide-line overflow-hidden rounded-lg bg-input/40">
            {/* Web UI */}
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-fill">
                <Globe className="h-3.5 w-3.5 text-fg-2" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">Browser</p>
                <p className="text-[11.5px] text-fg-4">Open the workspace.</p>
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
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-fill">
                <Terminal className="h-3.5 w-3.5 text-fg-2" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">CLI</p>
                <p className="truncate font-mono text-[11.5px] text-fg-4">{attachDisplay}</p>
              </div>
              <button
                type="button"
                onClick={() => copyText(attachCommand, "Command copied")}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-fill px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg-2 transition-colors hover:border-line-2 hover:text-fg"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>

            {/* OpenCode Desktop */}
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-fill">
                <Monitor className="h-3.5 w-3.5 text-fg-2" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">Desktop</p>
                <p className="truncate text-[11.5px] text-fg-4">
                  Credentials above · project <span className="font-mono">{projectPath}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => copyText(projectPath, "Project path copied")}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-fill px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg-2 transition-colors hover:border-line-2 hover:text-fg"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>
          </div>
        </div>

        {/* New session */}
        <Button
          type="button"
          variant="outline"
          disabled={isResetting}
          onClick={onReset}
          className="h-10 w-full border-line bg-transparent font-mono text-[11px] uppercase tracking-[0.18em] text-fg-2 hover:border-line-2 hover:text-fg disabled:opacity-40"
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteShell } from "@/components/site/site-shell";
import { authClient } from "@/lib/auth-client";
import { trpcClient } from "@/utils/trpc";

type Result = "approved" | "denied";

/** Uppercases, drops anything that can't be in a code, and adds the dash: ABCD-EFGH. */
function formatCode(value: string) {
  const chars = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

export default function DevicePage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push("/login?redirect=/device");
  }, [session, isPending, router]);

  async function submit(action: "approve" | "deny") {
    setError(null);
    setSubmitting(action === "approve" ? "approved" : "denied");
    try {
      await trpcClient.device.approve.mutate({ userCode: code, action });
      setResult(action === "approve" ? "approved" : "denied");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <SiteShell footer={false}>
      <div className="flex min-h-[calc(100svh-65px)] flex-col items-center justify-center px-4 py-16 sm:px-6">
        {isPending || !session ? (
          <Loader2 className="size-6 animate-spin text-fg-4" aria-label="Loading" />
        ) : result ? (
          <Done result={result} />
        ) : (
          <form
            className="w-full max-w-[22rem]"
            onSubmit={(e) => {
              e.preventDefault();
              if (code) submit("approve");
            }}
          >
            <div className="mb-9 text-center">
              <h1 className="m-0 text-[clamp(2rem,4vw,2.5rem)] leading-[1.05] font-display font-semibold tracking-[-0.03em] text-fg">
                Authorize a device
              </h1>
              <p className="mt-3 text-[16px] leading-[1.6] text-fg-3">
                Enter the code shown in your terminal.
              </p>
            </div>

            <label htmlFor="code" className="sr-only">
              Code
            </label>
            <Input
              id="code"
              placeholder="ABCD-EFGH"
              value={code}
              onChange={(e) => {
                setCode(formatCode(e.target.value));
                setError(null);
              }}
              autoFocus
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={!!error}
              aria-describedby={error ? "code-error" : undefined}
              className="h-14 border-line bg-fill text-center font-mono text-2xl tracking-[0.2em] text-fg placeholder:text-fg-4 md:text-2xl focus-visible:border-primary/50 focus-visible:ring-primary/20"
              disabled={!!submitting}
            />
            {error && (
              <p id="code-error" className="mt-2 text-center text-[14px] text-[#fb923c]">
                {error}
              </p>
            )}

            <div className="mt-4 flex gap-3">
              <Button type="submit" size="lg" className="flex-1" disabled={!code || !!submitting}>
                {submitting === "approved" && <Loader2 className="animate-spin" />}
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="flex-1"
                disabled={!code || !!submitting}
                onClick={() => submit("deny")}
              >
                {submitting === "denied" && <Loader2 className="animate-spin" />}
                Deny
              </Button>
            </div>

            <p className="mt-9 text-center text-[13px] leading-[1.6] text-fg-4">
              Only approve a device you control. It gets access to your workspaces.
            </p>
          </form>
        )}
      </div>
    </SiteShell>
  );
}

function Done({ result }: { result: Result }) {
  const approved = result === "approved";
  const Icon = approved ? CheckCircle2 : XCircle;
  return (
    <div className="w-full max-w-[22rem] text-center">
      <Icon
        className={approved ? "mx-auto size-10 text-primary" : "mx-auto size-10 text-fg-3"}
        strokeWidth={1.5}
        aria-hidden
      />
      <h1 className="mt-6 text-[clamp(2rem,4vw,2.5rem)] leading-[1.05] font-display font-semibold tracking-[-0.03em] text-fg">
        {approved ? "Device connected" : "Request denied"}
      </h1>
      <p className="mt-3 text-[16px] leading-[1.6] text-fg-3">
        {approved
          ? "Go back to your terminal to continue. You can close this tab."
          : "That device didn't get access. Run gitterm login again if this was a mistake."}
      </p>
      <Button asChild size="lg" variant={approved ? "default" : "outline"} className="mt-8 w-full">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}

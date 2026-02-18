"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle, XCircle, Shield, Loader2, Terminal } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { trpcClient } from "@/utils/trpc";

export default function DevicePage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [userCode, setUserCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalized = useMemo(() => userCode.trim().toUpperCase(), [userCode]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login?redirect=/device");
    }
  }, [session, isPending, router]);

  async function submit(action: "approve" | "deny") {
    if (!normalized) {
      toast.error("Enter a code");
      return;
    }

    setIsSubmitting(true);
    try {
      await trpcClient.device.approve.mutate({
        userCode: normalized,
        action,
      });
      toast.success(action === "approve" ? "Device approved" : "Device denied");
      setUserCode("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
        <Loader2 className="h-8 w-8 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] landing-grid dark">
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Terminal className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Authorize Device
            </h1>
            <p className="mt-2 text-sm text-white/40">
              Enter the code from your terminal to connect this CLI session.
            </p>
          </div>

          {/* Code input */}
          <div className="space-y-2">
            <label
              htmlFor="code"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/30"
            >
              Authorization Code
            </label>
            <Input
              id="code"
              placeholder="ABCD-EFGH"
              value={userCode}
              onChange={(e) => setUserCode(e.target.value)}
              autoCapitalize="characters"
              spellCheck={false}
              className="h-14 border-white/[0.08] bg-white/[0.02] text-center font-mono text-2xl tracking-[0.3em] text-white placeholder:text-white/20"
              disabled={isSubmitting}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              onClick={() => submit("approve")}
              disabled={isSubmitting || !normalized}
              className="flex-1 bg-primary font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => submit("deny")}
              disabled={isSubmitting || !normalized}
              className="flex-1 border-white/[0.08] bg-transparent font-mono text-sm text-white/60 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Deny
            </Button>
          </div>

          {/* Security notice */}
          <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />
            <p className="text-xs leading-relaxed text-white/35">
              Only approve devices you personally control. This grants access to
              your GitTerm workspaces.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-white/25">
          Need help?{" "}
          <Link
            href="/"
            className="text-white/40 underline decoration-white/20 underline-offset-2 hover:text-white/60"
          >
            Return home
          </Link>
        </p>
      </footer>
    </div>
  );
}

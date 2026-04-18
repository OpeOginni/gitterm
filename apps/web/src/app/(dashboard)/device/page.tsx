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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background landing-grid dark">
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Terminal className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Authorize Device</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the code from your terminal to connect this CLI session.
            </p>
          </div>

          {/* Code input */}
          <div className="space-y-2">
            <label
              htmlFor="code"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70"
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
              className="h-14 border-border bg-secondary text-center font-mono text-2xl tracking-[0.3em] text-foreground placeholder:text-muted-foreground/50"
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
              className="flex-1 border-border bg-transparent font-mono text-sm text-secondary-foreground hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Deny
            </Button>
          </div>

          {/* Security notice */}
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground/80">
              Only approve devices you personally control. This grants access to your GitTerm
              workspaces.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-muted-foreground/60">
          Need help?{" "}
          <Link
            href="/"
            className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground/70"
          >
            Return home
          </Link>
        </p>
      </footer>
    </div>
  );
}

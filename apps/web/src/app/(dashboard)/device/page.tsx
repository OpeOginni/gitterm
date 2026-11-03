"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle, XCircle, Shield, Loader2 } from "lucide-react";
import { Brand } from "@/components/site/site-header";
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
        <Loader2 className="h-8 w-8 animate-spin text-fg-4" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background landing-grid dark">
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="text-center">
            <Brand className="mb-8 justify-center" />
            <h1 className="font-display text-[26px] font-semibold tracking-[-0.025em] text-fg">
              Authorize a device
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-3">
              Enter the code from your terminal to connect this CLI session.
            </p>
          </div>

          {/* Code input */}
          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium text-fg-2">
              Authorization code
            </label>
            <Input
              id="code"
              placeholder="ABCD-EFGH"
              value={userCode}
              onChange={(e) => setUserCode(e.target.value)}
              autoCapitalize="characters"
              spellCheck={false}
              className="h-14 text-center font-mono text-2xl tracking-[0.3em] text-fg placeholder:text-fg-4"
              disabled={isSubmitting}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              onClick={() => submit("approve")}
              disabled={isSubmitting || !normalized}
              className="h-11 flex-1"
            >
              <CheckCircle className="size-4" />
              Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => submit("deny")}
              disabled={isSubmitting || !normalized}
              className="h-11 flex-1 hover:bg-red-500/10 hover:text-red-300"
            >
              <XCircle className="size-4" />
              Deny
            </Button>
          </div>

          {/* Security notice */}
          <div className="flex items-start gap-3 rounded-xl bg-fill p-4">
            <Shield className="mt-0.5 size-4 shrink-0 text-fg-3" />
            <p className="text-[13px] leading-relaxed text-fg-3">
              Only approve devices you control. Approving gives this CLI access to your Gitterm
              workspaces.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-[13px] text-fg-4">
          <Link
            href="/"
            className="underline decoration-line-2 underline-offset-2 transition-colors hover:text-fg-2"
          >
            Back to home
          </Link>
        </p>
      </footer>
    </div>
  );
}

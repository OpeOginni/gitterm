"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteShell } from "@/components/site/site-shell";

function LoginContent() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const error = searchParams.get("error");

  return (
    <SiteShell footer={false}>
      <div className="flex min-h-[calc(100svh-65px)] flex-col items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full max-w-[22rem]">
          <div className="mb-9 text-center">
            <h1 className="m-0 text-[clamp(2rem,4vw,2.5rem)] leading-[1.05] font-display font-semibold tracking-[-0.03em] text-fg">
              Sign in to gitterm
            </h1>
            <p className="mt-3 text-[16px] leading-[1.6] text-fg-3">
              Your sandboxes and workspaces are waiting.
            </p>
          </div>

          <AuthForm redirectUrl={redirect ?? undefined} authError={error} />

          <p className="mt-9 text-center text-[13px] leading-[1.6] text-fg-4">
            By signing in, you agree to our{" "}
            <Link
              href="/terms"
              className="text-fg-3 underline decoration-line-2 underline-offset-2 hover:text-fg-2"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="text-fg-3 underline decoration-line-2 underline-offset-2 hover:text-fg-2"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </SiteShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="dark min-h-screen bg-background" />}>
      <LoginContent />
    </Suspense>
  );
}

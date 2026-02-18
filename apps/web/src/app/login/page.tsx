"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { Terminal } from "lucide-react";
import Link from "next/link";

function LoginContent() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] landing-grid dark">
      {/* Minimal header */}
      <header className="border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-70"
          >
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider text-white/90">
              GitTerm
            </span>
          </Link>
        </div>
      </header>

      {/* Center content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          {/* Brand mark */}
          <div className="flex flex-col items-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Terminal className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Sign in to GitTerm
              </h1>
              <p className="mt-2 text-sm text-white/40">
                Access your workspaces and start shipping.
              </p>
            </div>
          </div>

          {/* Auth Form */}
          <AuthForm redirectUrl={redirect ?? undefined} />

          {/* Footer text */}
          <p className="text-center text-xs text-white/30">
            By signing in, you agree to our{" "}
            <Link
              href="#"
              className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white/70"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="#"
              className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white/70"
            >
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

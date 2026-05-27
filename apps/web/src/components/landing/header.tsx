"use client";

import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Star, Terminal } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { isBillingEnabled } from "@gitterm/env/web";

export function LandingHeader() {
  const { data: session } = authClient.useSession();
  const showPricing = isBillingEnabled();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <Terminal className="h-5 w-5 text-primary" />
          <span className="font-mono text-sm font-bold tracking-[0.18em] uppercase text-white/90">
            GitTerm
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.25em] text-white/30 sm:inline">
            / cloud workspaces
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link
            href="/#features"
            className="font-mono text-xs uppercase tracking-widest text-white/40 transition-colors hover:text-white/80"
          >
            Features
          </Link>
          <Link
            href="/#how-it-works"
            className="font-mono text-xs uppercase tracking-widest text-white/40 transition-colors hover:text-white/80"
          >
            How it works
          </Link>
          {showPricing && (
            <Link
              href={"/pricing" as Route}
              className="font-mono text-xs uppercase tracking-widest text-white/40 transition-colors hover:text-white/80"
            >
              Pricing
            </Link>
          )}
          <Link
            href={"/enterprise" as Route}
            className="font-mono text-xs uppercase tracking-widest text-white/40 transition-colors hover:text-white/80"
          >
            Enterprise
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          <Link
            href="https://github.com/OpeOginni/gitterm"
            target="_blank"
            title="Star on GitHub"
            className="inline-flex"
          >
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-white/8 bg-transparent px-2.5 text-white/50 transition-colors hover:border-primary hover:text-white/80 sm:px-3"
            >
              <Star className="h-3.5 w-3.5 shrink-0 text-primary sm:mr-1.5" />
              <span className="hidden font-mono text-xs sm:inline">Star on Github</span>
            </Button>
          </Link>
          {session ? (
            <Link href="/dashboard">
              <Button
                size="sm"
                className="h-8 bg-primary px-4 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
              >
                Dashboard
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden sm:inline-flex">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 font-mono text-xs text-white/50 hover:text-white/80"
                >
                  Log in
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button
                  size="sm"
                  className="h-8 bg-primary px-3 font-mono text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground hover:bg-primary/85 sm:px-4"
                >
                  Get Started
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import type { Route } from "next";
import { Terminal } from "lucide-react";
import { isBillingEnabled } from "@gitterm/env/web";

export function Footer() {
  const showPricing = isBillingEnabled();

  return (
    <footer className="border-t border-white/[0.06] py-10">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white/70">
              GitTerm
            </span>
          </div>

          <nav className="flex items-center gap-6 font-mono text-xs text-white/35">
            <Link
              href="/dashboard"
              className="uppercase tracking-widest transition-colors hover:text-white/70"
            >
              Dashboard
            </Link>
            {showPricing && (
              <Link
                href={"/pricing" as Route}
                className="uppercase tracking-widest transition-colors hover:text-white/70"
              >
                Pricing
              </Link>
            )}
            <Link
              href="https://www.npmjs.com/package/gitterm"
              target="_blank"
              className="uppercase tracking-widest transition-colors hover:text-white/70"
            >
              npm
            </Link>
            <Link
              href="https://github.com/OpeOginni/gitterm"
              target="_blank"
              className="uppercase tracking-widest transition-colors hover:text-white/70"
            >
              GitHub
            </Link>
          </nav>

          <p className="text-xs text-white/30">
            Built by{" "}
            <Link
              href="https://github.com/opeoginni"
              target="_blank"
              className="text-white/50 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/70"
            >
              @opeoginni
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

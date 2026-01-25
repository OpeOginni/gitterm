"use client";

import Link from "next/link";
import type { Route } from "next";
import { Terminal } from "lucide-react";
import { isBillingEnabled } from "@gitterm/env/web";

export function Footer() {
  const showPricing = isBillingEnabled();

  return (
    <footer className="border-t border-border py-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">GitTerm</span>
          </div>

          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">
              Dashboard
            </Link>
            {showPricing && (
              <Link href={"/pricing" as Route} className="hover:text-foreground transition-colors">
                Pricing
              </Link>
            )}
            <Link
              href="https://www.npmjs.com/package/gitterm"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              npm
            </Link>
          </nav>

          <p className="text-sm text-muted-foreground">
            Built by{" "}
            <Link
              href="https://github.com/opeoginni"
              target="_blank"
              className="hover:text-foreground transition-colors underline"
            >
              @opeoginni
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

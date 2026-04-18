"use client";

import Link from "next/link";
import type { Route } from "next";
import { Terminal } from "lucide-react";
import { isBillingEnabled } from "@gitterm/env/web";

export function Footer() {
  const showPricing = isBillingEnabled();

  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-70">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground/80">
              GitTerm
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <Link href="/dashboard" className="transition-colors hover:text-foreground">
              Dashboard
            </Link>
            {showPricing && (
              <Link href={"/pricing" as Route} className="transition-colors hover:text-foreground">
                Pricing
              </Link>
            )}
            <Link href={"/enterprise" as Route} className="transition-colors hover:text-foreground">
              Enterprise
            </Link>
            <Link
              href="https://github.com/OpeOginni/gitterm"
              target="_blank"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </Link>
            <Link
              href="https://www.npmjs.com/package/gitterm"
              target="_blank"
              className="transition-colors hover:text-foreground"
            >
              npm
            </Link>
          </nav>

          <p className="text-xs text-muted-foreground/50">
            Built by{" "}
            <Link
              href="https://github.com/opeoginni"
              target="_blank"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              @opeoginni
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

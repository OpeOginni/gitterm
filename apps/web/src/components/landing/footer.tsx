"use client";

import Link from "next/link";
import type { Route } from "next";
import { Terminal } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-line py-8 sm:py-10">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:grid md:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-fg-2">
              GitTerm
            </span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-xs text-fg-4 sm:gap-6 md:justify-self-center">
            <Link
              href={"/privacy" as Route}
              className="uppercase tracking-widest transition-colors hover:text-fg-2"
            >
              Privacy
            </Link>
            <Link
              href={"/terms" as Route}
              className="uppercase tracking-widest transition-colors hover:text-fg-2"
            >
              Terms
            </Link>
          </nav>

          <p className="text-xs text-fg-4 md:justify-self-end">
            MIT-licensed open source · Built by{" "}
            <Link
              href="https://github.com/opeoginni"
              target="_blank"
              className="text-fg-3 underline decoration-line-2 underline-offset-2 transition-colors hover:text-fg-2"
            >
              @opeoginni
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

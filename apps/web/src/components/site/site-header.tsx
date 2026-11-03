"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { isBillingEnabled } from "@gitterm/env/web";
import { authClient } from "@/lib/auth-client";
import { GitHub } from "@/components/logos/Github";
import { GITHUB_URL } from "@/lib/site/providers";
import { cn } from "@/lib/utils";

/** The gitterm mark: a gold plus (the attach point) and the lowercase wordmark. */
export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 text-[18px] font-semibold tracking-[-0.02em] text-fg",
        className,
      )}
    >
      <svg
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        aria-hidden
        className="size-[18px] text-primary"
      >
        <path d="M9 1v16M1 9h16" />
      </svg>
      gitterm
    </span>
  );
}

type NavItem = { label: string; href: Route; show?: boolean };

export function SiteHeader({ wide = false }: { wide?: boolean }) {
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const nav: NavItem[] = [
    { label: "Sandboxes", href: "/#providers" as Route },
    { label: "Cloud agents", href: "/#agents" as Route },
    { label: "Docs", href: "/docs" as Route },
    { label: "Pricing", href: "/pricing" as Route, show: isBillingEnabled() },
    { label: "Self-host", href: "/self-host" as Route },
  ];
  const items = nav.filter((n) => n.show !== false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur-xl">
      <div
        className={cn(
          "mx-auto flex h-16 items-center justify-between gap-6 px-4 sm:px-6",
          wide ? "max-w-[1400px]" : "max-w-[1240px]",
        )}
      >
        <Link
          href="/"
          className="rounded-md transition-opacity hover:opacity-85"
          aria-label="gitterm home"
        >
          <Brand />
        </Link>

        <nav
          aria-label="Main"
          className="hidden items-center gap-7 text-[14.5px] text-fg-2 min-[900px]:flex"
        >
          {items.map((n) => (
            <Link key={n.label} href={n.href} className="transition-colors hover:text-fg">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Gitterm on GitHub"
            className="hidden size-9 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg sm:inline-flex"
          >
            <GitHub fill="currentColor" className="size-[18px]" />
          </a>
          {!session && (
            <Link
              href={"/login" as Route}
              className="hidden h-9 items-center rounded-lg px-3 text-[14px] font-medium text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg sm:inline-flex"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-[#c09a45]"
          >
            {session ? "Dashboard" : "Get started"}
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg min-[900px]:hidden"
          >
            {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
          </button>
        </div>
      </div>

      {open && (
        <nav aria-label="Main" className="border-t border-line bg-background/95 min-[900px]:hidden">
          <div
            className={cn(
              "mx-auto flex flex-col px-4 py-2 sm:px-6",
              wide ? "max-w-[1400px]" : "max-w-[1240px]",
            )}
          >
            {items.map((n) => (
              <Link
                key={n.label}
                href={n.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center border-b border-line text-[15px] text-fg-2 last:border-b-0 hover:text-fg"
              >
                {n.label}
              </Link>
            ))}
            {!session && (
              <Link
                href={"/login" as Route}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center text-[15px] text-fg-2 hover:text-fg"
              >
                Sign in
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

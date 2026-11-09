import Link from "next/link";
import type { Route } from "next";
import { GITHUB_URL } from "@/lib/site/providers";
import { cn } from "@/lib/utils";
import { Brand } from "./site-header";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
  { label: "Self-host", href: "/self-host" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "GitHub", href: GITHUB_URL, external: true },
  { label: "Contact", href: "mailto:help@gitterm.dev", external: true },
];

export function SiteFooter({ wide = false }: { wide?: boolean }) {
  return (
    <footer className="border-t border-line py-9">
      <div
        className={cn(
          "mx-auto flex flex-col gap-5 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6",
          wide ? "max-w-[1400px]" : "max-w-[1240px]",
        )}
      >
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <Brand className="text-[16px]" />
          <span className="text-[14px] text-fg-3">Give your agents more room to work.</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-fg-3">
          {LINKS.map((l) =>
            l.external ? (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="min-h-6 transition-colors hover:text-fg"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.label}
                href={l.href as Route}
                className="min-h-6 transition-colors hover:text-fg"
              >
                {l.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}

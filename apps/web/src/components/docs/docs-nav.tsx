"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavData = { title: string; pages: { slug: string; title: string }[] }[];

function NavList({
  nav,
  active,
  onNavigate,
}: {
  nav: NavData;
  active?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-7">
      {nav.map((section) => (
        <div key={section.title}>
          <p className="mb-2.5 text-[13.5px] font-medium text-fg">{section.title}</p>
          <ul className="border-l border-line">
            {section.pages.map((page) => {
              const current = page.slug === active;
              return (
                <li key={page.slug}>
                  <Link
                    href={`/docs/${page.slug}` as Route}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "-ml-px flex min-h-11 items-center border-l-2 border-transparent pl-3.5 text-[14.5px] leading-snug text-fg-3 transition-colors hover:text-fg lg:min-h-0 lg:py-1.5",
                      current && "border-primary text-fg",
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Left sidebar on desktop; a compact "current page" menu under the header on phones. */
export function DocsNav({ nav }: { nav: NavData }) {
  const pathname = usePathname();
  const active = pathname.replace(/^\/docs\/?/, "");
  const [open, setOpen] = useState(false);
  const section = nav.find((s) => s.pages.some((p) => p.slug === active));
  const currentTitle = section?.pages.find((p) => p.slug === active)?.title;

  return (
    <>
      <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto py-10 pr-2 [scrollbar-width:thin] lg:block">
        <nav aria-label="Docs">
          <NavList nav={nav} active={active} />
        </nav>
      </aside>

      <div className="sticky top-16 z-40 -mx-4 border-b border-line bg-background/90 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-full items-center justify-between gap-3 text-left text-[14.5px] text-fg-2"
        >
          <span className="truncate">
            <span className="text-fg-4">{section ? `${section.title} / ` : "Docs"}</span>
            {currentTitle}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <nav aria-label="Docs" className="max-h-[70vh] overflow-y-auto pt-2 pb-6">
            <NavList nav={nav} active={active} onNavigate={() => setOpen(false)} />
          </nav>
        )}
      </div>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/lib/docs/markdown";
import { cn } from "@/lib/utils";

/** "On this page": h2/h3 links; the section under the header is highlighted. */
export function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | undefined>(items[0]?.id);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | undefined = items[0]?.id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top < 120) current = item.id;
      }
      // At the very bottom, the last section wins even if its heading can't reach the top.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = items.at(-1)?.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items]);

  if (items.length === 0) return null;
  return (
    <nav
      aria-label="On this page"
      className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10 [scrollbar-width:thin]"
    >
      <p className="mb-3 text-[13.5px] font-medium text-fg">On this page</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "block py-1 text-[13.5px] leading-snug transition-colors hover:text-fg",
                item.depth === 3 && "pl-3.5",
                item.id === active ? "text-[#e2c47c]" : "text-fg-3",
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

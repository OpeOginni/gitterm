"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode };

/**
 * Smooth segmented control used across the site: a soft rounded track with a thumb that
 * slides to the selected option. One style for every switch on the site.
 */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  fill = false,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  /** Stretch options to fill the width (used on phones). */
  fill?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = track.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!el) return;
    const sync = () => setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  return (
    <div
      ref={track}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex gap-0.5 rounded-[14px] bg-white/[0.035] p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]",
        fill && "flex w-full",
        className,
      )}
    >
      {thumb && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-[10px] bg-gradient-to-b from-[#24242b] to-[#1c1c22] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),inset_0_1px_0_rgba(255,255,255,0.06),0_6px_18px_rgba(0,0,0,0.35)] transition-[transform,width] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-[1] inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] px-[18px] text-[14.5px] font-medium whitespace-nowrap text-fg-3 transition-colors hover:text-fg-2 aria-pressed:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
            fill && "min-w-0 flex-1 px-2",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "muted";

const DOT: Record<Tone, string> = {
  ok: "bg-[#6bd586]",
  warn: "bg-[#fb923c]",
  muted: "bg-fg-4",
};

const TEXT: Record<Tone, string> = {
  ok: "text-[#6bd586]",
  warn: "text-[#fb923c]",
  muted: "text-fg-3",
};

/** Quiet status chip: a dot and sentence-case text on a soft fill, no outline. */
export function StatusChip({
  tone = "muted",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-2 py-0.5 text-[12.5px] font-medium whitespace-nowrap",
        TEXT[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

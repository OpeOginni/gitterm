import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The landing page's building blocks for dashboard pages: headings set in the display face,
 * hairline panels and grids instead of filled cards, and status dots.
 */

export function SectionHeading({
  title,
  count,
  description,
  action,
  className,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-3", className)}>
      <h2 className="font-display text-[22px] leading-tight font-semibold tracking-[-0.02em] text-fg">
        {title}
        {count ? (
          <span className="ml-2.5 font-sans text-[15px] font-normal tracking-normal text-fg-3 tabular-nums">
            {count}
          </span>
        ) : null}
      </h2>
      {description ? (
        <p className="max-w-sm text-[13.5px] leading-relaxed text-fg-3">{description}</p>
      ) : null}
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A hairline-bordered list. Children are rows; lines separate them. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "divide-y divide-line overflow-hidden rounded-xl border border-line",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3.5 px-4 py-3.5 sm:px-5", className)}>{children}</div>
  );
}

/** A grid of cells separated by hairlines, like the landing page's feature grids. */
export function LineGrid({
  children,
  className,
}: {
  children: ReactNode;
  /** Column classes, e.g. "md:grid-cols-2 xl:grid-cols-3". */
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-px overflow-hidden rounded-xl border border-line bg-line", className)}
    >
      {children}
    </div>
  );
}

/** One cell of a LineGrid. Opaque, so the grid's lines show between cells. */
export function LineCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 bg-background p-5", className)}>{children}</div>
  );
}

export function StatStrip({
  stats,
  className,
}: {
  stats: Array<{ label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }>;
  className?: string;
}) {
  return (
    <LineGrid
      className={cn(
        "grid-cols-2",
        stats.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        className,
      )}
    >
      {stats.map((stat) => (
        <LineCell key={stat.label} className="gap-1">
          <span className="text-[12.5px] text-fg-3">{stat.label}</span>
          <span
            className={cn(
              "font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums",
              stat.tone ? TONE_TEXT[stat.tone] : "text-fg",
            )}
          >
            {stat.value}
          </span>
          {stat.hint ? <span className="text-[12.5px] text-fg-4">{stat.hint}</span> : null}
        </LineCell>
      ))}
    </LineGrid>
  );
}

export type Tone = "ok" | "busy" | "paused" | "warn" | "danger" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[#6bd586]",
  busy: "text-primary",
  paused: "text-yellow-600 dark:text-yellow-300",
  warn: "text-[#fb923c]",
  danger: "text-destructive",
  muted: "text-fg-3",
};
const TONE_DOT: Record<Tone, string> = {
  ok: "bg-[#6bd586]",
  busy: "bg-primary",
  paused: "bg-yellow-500 dark:bg-yellow-300",
  warn: "bg-[#fb923c]",
  danger: "bg-destructive",
  muted: "bg-fg-4",
};

/** A status as a coloured dot and its label, as in the landing page's workspace list. */
export function StatusDot({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12.5px] font-medium",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          TONE_DOT[tone],
          pulse && "motion-safe:animate-pulse",
        )}
      />
      {children}
    </span>
  );
}

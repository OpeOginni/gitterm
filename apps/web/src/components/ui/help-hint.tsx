"use client";

import { CircleQuestionMark } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Small `?` affordance that explains a nearby control.
 *
 * Hover is a pointer idea, so the two form factors use different primitives:
 *   - pointer: a tooltip on hover after a short delay
 *   - touch:   a popover that opens on tap and dismisses on the next tap
 *              outside it (or Escape), which is how help works on mobile
 *
 * Placement differs to match: beside the control on desktop where there is
 * horizontal room, below it on phones where there is not.
 */
export function HelpHint({
  children,
  label,
  className,
  side = "right",
  mobileSide = "bottom",
}: {
  /** The explanation itself. */
  children: ReactNode;
  /** Accessible name for the trigger, e.g. "What does a GitHub connection do?". */
  label: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  mobileSide?: "top" | "right" | "bottom" | "left";
}) {
  const isMobile = useIsMobile();

  const trigger = (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-4 transition-colors hover:text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:text-fg-2",
        className,
      )}
    >
      <CircleQuestionMark className="h-3.5 w-3.5" />
    </button>
  );

  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          side={mobileSide}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="w-auto max-w-[min(20rem,calc(100vw-2rem))] p-3 text-[12.5px] leading-relaxed text-fg-2"
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={2}
        className="max-w-[15rem] text-[11px] sm:max-w-none sm:text-nowrap"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

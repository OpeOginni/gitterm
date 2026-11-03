"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

/**
 * Looks like the site's `Seg` switch: a soft track with a thumb that slides to the active tab.
 * The thumb follows whichever trigger has `data-state="active"`.
 */
function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const track = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ x: number; w: number } | null>(null);

  React.useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const sync = () => {
      const active = el.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      setThumb(active ? { x: active.offsetLeft, w: active.offsetWidth } : null);
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={track}
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex w-fit items-center gap-0.5 rounded-[14px] bg-fill p-1 text-fg-3 shadow-[inset_0_0_0_1px_var(--line)]",
        className,
      )}
      {...props}
    >
      {thumb && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-[10px] bg-gradient-to-b from-[#24242b] to-[#1c1c22] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),inset_0_1px_0_rgba(255,255,255,0.06),0_6px_18px_rgba(0,0,0,0.35)] transition-[transform,width] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative z-[1] inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap text-fg-3 transition-colors outline-none hover:text-fg-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-fg [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };

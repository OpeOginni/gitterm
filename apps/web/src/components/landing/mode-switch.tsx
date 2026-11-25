"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MODE_EVENT, type DemoMode } from "./engine";

const CAPTION: Record<DemoMode, string> = {
  with: "Sandboxes attach as the agent needs them.",
  without: "OpenCode on its own. Everything runs on your laptop.",
};

const TABS: { value: DemoMode; label: string; line: string }[] = [
  {
    value: "without",
    label: "Without Gitterm",
    // Grows from and shrinks to its right end, the middle of the rule.
    line: "after:origin-right after:bg-[#fb923c] after:shadow-[0_0_12px_1px_rgba(251,146,60,0.6)]",
  },
  {
    value: "with",
    label: "With Gitterm",
    // Grows from and shrinks to its left end, the middle of the rule.
    line: "after:origin-left after:bg-primary after:shadow-[0_0_12px_1px_rgba(211,173,85,0.65)]",
  },
];

/** "Without Gitterm / With Gitterm": tells the demo engine to replay the session in that mode. */
export function ModeSwitch() {
  const [mode, setMode] = useState<DemoMode>("with");
  const ref = useRef<HTMLDivElement>(null);
  const pick = (m: DemoMode) => {
    setMode(m);
    ref.current?.closest(".lp")?.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: m }));
  };
  // The demo can switch modes too ("Run it with Gitterm" after the crash)
  useEffect(() => {
    const root = ref.current?.closest(".lp");
    const sync = (e: Event) => setMode((e as CustomEvent<DemoMode>).detail);
    root?.addEventListener(MODE_EVENT, sync);
    return () => root?.removeEventListener(MODE_EVENT, sync);
  }, []);
  return (
    <div ref={ref} className="mt-12 mb-[30px] flex flex-col items-center gap-3">
      {/* Two tabs over a faint rule; the picked one's stretch of it lights up and glows. Switching
          runs the light across the middle: the old stretch drains into it, then the new one fills
          out from it. */}
      <div
        role="group"
        aria-label="Compare the session"
        className="flex border-b border-line max-[560px]:w-full"
      >
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={mode === t.value}
            onClick={() => pick(t.value)}
            className={cn(
              "relative -mb-px cursor-pointer px-6 select-none pt-1 pb-3 text-[15px] font-medium text-fg-4 transition-colors duration-300 hover:text-fg-2 aria-pressed:text-fg max-[560px]:flex-1 max-[560px]:px-2",
              "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:scale-x-0 after:rounded-full after:transition-transform after:duration-[260ms] after:ease-in aria-pressed:after:scale-x-100 aria-pressed:after:delay-[260ms] aria-pressed:after:duration-[380ms] aria-pressed:after:ease-[cubic-bezier(0.22,1,0.36,1)]",
              t.line,
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="m-0 text-center text-[15px] text-fg-3" aria-live="polite">
        {CAPTION[mode]}
      </p>
    </div>
  );
}

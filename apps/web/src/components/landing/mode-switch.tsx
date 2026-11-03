"use client";

import { useRef, useState } from "react";
import { Seg } from "@/components/site/seg";
import { cn } from "@/lib/utils";
import { MODE_EVENT, type DemoMode } from "./engine";

const CAPTION: Record<DemoMode, string> = {
  with: "Sandboxes attach as the agent needs them.",
  without: "OpenCode on its own. Everything runs on your laptop.",
};

function Dot({ on, tone }: { on: boolean; tone: "warn" | "gold" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-[7px] rounded-full bg-fg-4 transition-[background-color,box-shadow] duration-250",
        on && tone === "warn" && "bg-[#fb923c] shadow-[0_0_0_3px_rgba(251,146,60,0.15)]",
        on && tone === "gold" && "bg-primary shadow-[0_0_0_3px_rgba(211,173,85,0.16)]",
      )}
    />
  );
}

/** "Without Gitterm / With Gitterm": tells the demo engine to replay the session in that mode. */
export function ModeSwitch() {
  const [mode, setMode] = useState<DemoMode>("with");
  const ref = useRef<HTMLDivElement>(null);
  const pick = (m: DemoMode) => {
    setMode(m);
    ref.current?.closest(".lp")?.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: m }));
  };
  return (
    <div ref={ref} className="mt-12 mb-[30px] flex flex-col items-center gap-3">
      <Seg
        ariaLabel="Compare the session"
        value={mode}
        onChange={pick}
        className="max-[560px]:flex max-[560px]:w-full max-[560px]:[&>button]:min-h-11 max-[560px]:[&>button]:min-w-0 max-[560px]:[&>button]:flex-1 max-[560px]:[&>button]:px-2 max-[560px]:[&>button]:text-[14px]"
        options={[
          {
            value: "without",
            label: "Without Gitterm",
            icon: <Dot on={mode === "without"} tone="warn" />,
          },
          { value: "with", label: "With Gitterm", icon: <Dot on={mode === "with"} tone="gold" /> },
        ]}
      />
      <p className="m-0 text-center text-[15px] text-fg-3" aria-live="polite">
        {CAPTION[mode]}
      </p>
    </div>
  );
}

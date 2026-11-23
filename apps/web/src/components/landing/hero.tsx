"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/site/copy-button";
import { INSTALL_SETUP, T3_LOGO } from "@/lib/site/providers";
import { cn } from "@/lib/utils";
import { ClickToCopy } from "./click-to-copy";
import { Logo } from "./logo";

/** `icon` marks a square app icon, which gets rounded corners; the other marks are drawn shapes. */
const AGENTS = [
  { logo: "/opencode.svg", name: "OpenCode" },
  { logo: "/pi.svg", name: "Pi" },
  { logo: T3_LOGO, name: "T3 Code", icon: true },
  { logo: "/openai-codex.svg", name: "Codex" },
  { logo: "/claude.svg", name: "Claude Code" },
];
/** The headline's last line: "your agents", each agent, then "your agents" again to roll back to. */
const LINES = [undefined, ...AGENTS, undefined];
const STEP_MS = 2200;

/**
 * The hero headline and the agents it is for. Once in view it says "your agents", then rolls
 * through each agent in turn while the same agent lights up in the row below.
 */
export function AgentRoll() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  // Set for one frame after the roll reaches the repeated first line, to jump back without a roll.
  const [snap, setSnap] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([entry]) => {
      clearInterval(timer);
      if (entry?.isIntersecting) timer = setInterval(() => setStep((s) => s + 1), STEP_MS);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!snap) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSnap(false)));
    return () => cancelAnimationFrame(frame);
  }, [snap]);

  const current = LINES[step];
  return (
    <div ref={ref}>
      <h1
        className="mx-auto text-[clamp(2rem,6.6vw,5.4rem)] leading-[1.02] font-display font-semibold tracking-[-0.035em] text-fg"
        aria-label="More computers for your agents."
      >
        <span aria-hidden>
          <span className="block">More computers</span>
          for{" "}
        </span>
        {/* Only the agent rolls, left-aligned after "for"; the slot is as wide as the longest name. */}
        <span
          className="inline-block h-[1.15em] overflow-hidden text-left align-bottom"
          aria-hidden
        >
          <span
            className={cn(
              "flex flex-col items-start",
              !snap && "transition-transform duration-[650ms] ease-[cubic-bezier(0.7,0,0.3,1)]",
            )}
            style={{ transform: `translateY(-${step * 1.15}em)` }}
            onTransitionEnd={() => {
              if (step === LINES.length - 1) {
                setSnap(true);
                setStep(0);
              }
            }}
          >
            {LINES.map((agent, i) => (
              <span
                key={i}
                className="flex h-[1.15em] items-center gap-[0.22em] whitespace-nowrap text-primary"
              >
                {agent && (
                  <Logo
                    src={agent.logo}
                    className={cn("size-[0.72em]", agent.icon && "rounded-[0.12em]")}
                  />
                )}
                {agent ? agent.name : "your agents"}.
              </span>
            ))}
          </span>
        </span>
      </h1>
      <ul className="mx-auto mt-9 mb-0 flex list-none justify-center gap-[clamp(14px,4.5vw,40px)] p-0">
        {AGENTS.map((agent) => {
          // Every agent is lit while the headline says "your agents".
          const lit = !current || current === agent;
          return (
            <li
              key={agent.name}
              className={cn(
                "flex flex-col items-center gap-2 text-[13px] whitespace-nowrap transition-colors duration-500 max-[420px]:text-[11px]",
                lit ? "text-fg" : "text-fg-4",
              )}
            >
              <Logo
                src={agent.logo}
                className={cn(
                  "size-[26px] transition-[filter,opacity,translate] duration-500",
                  agent.icon && "rounded-[5px]",
                  lit ? "-translate-y-0.5" : "opacity-40 grayscale",
                )}
              />
              {agent.name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The setup command. Clicking anywhere copies it; hovering draws a gold line along the top. */
export function SetupCommand({
  location,
  className,
}: {
  /** Where on the page this sits, for the copy event. */
  location: "hero" | "cta";
  className?: string;
}) {
  return (
    <ClickToCopy
      className={cn(
        "setup-cmd group/cmd relative flex items-center gap-4 border-t-2 border-primary bg-fill py-3.5 pr-3.5 pl-5 text-left",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[15px] text-fg">
        <span className="text-primary/70 transition-colors group-hover/cmd:text-primary">$ </span>
        {INSTALL_SETUP}
      </code>
      <CopyButton
        value={INSTALL_SETUP}
        installLocation={location}
        icon
        target
        className="prompt-copy group-focus-within/cmd:bg-primary group-focus-within/cmd:text-primary-foreground group-hover/cmd:bg-primary group-hover/cmd:text-primary-foreground hover:bg-[#c09a45] hover:text-primary-foreground"
      />
    </ClickToCopy>
  );
}

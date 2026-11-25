"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/site/copy-button";
import { INSTALL_SETUP, T3_LOGO } from "@/lib/site/providers";
import { cn } from "@/lib/utils";
import { ClickToCopy } from "./click-to-copy";
import { Logo } from "./logo";

/**
 * `icon` marks a square app icon, which gets rounded corners; the other marks are drawn shapes.
 * `float` places its tile beside the headline on wide screens (1200px and up): `x` is the side
 * (negative is left), `y` how far down the hero, `gap` extra pixels out from the headline.
 */
const AGENTS = [
  { logo: "/opencode.svg", name: "OpenCode", float: { x: -1, y: "20%", gap: 30, delay: 0 } },
  { logo: "/pi.svg", name: "Pi", float: { x: -1, y: "58%", gap: 90, delay: 1.2 } },
  {
    logo: T3_LOGO,
    name: "T3 Code",
    icon: true,
    float: { x: 1, y: "16%", gap: 50, delay: 0.6 },
  },
  { logo: "/openai-codex.svg", name: "Codex", float: { x: 1, y: "50%", gap: 90, delay: 1.8 } },
  { logo: "/claude.svg", name: "Claude Code", float: { x: 1, y: "78%", gap: 0, delay: 0.9 } },
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
        <span className="block" aria-hidden>
          More computers for
        </span>
        <span className="inline-block h-[1.15em] overflow-hidden align-bottom" aria-hidden>
          <span
            className={cn(
              "flex flex-col items-center",
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
      {/* Wide screens: the agents float in the space around the headline, and the one it names
          glows with its name under it. The hero section is their positioning box. */}
      <ul className="agent-float m-0 hidden list-none p-0 min-[1200px]:block">
        {AGENTS.map((agent) => {
          const named = current === agent;
          const { x, y, gap, delay } = agent.float;
          return (
            <li
              key={agent.name}
              className={cn(!current && "lit", named && "named")}
              style={{
                top: y,
                // Clear of the headline (at most 380px either side of the centre), moving out
                // as the screen widens so wide screens use their space and 1200px still fits.
                [x < 0 ? "right" : "left"]: `calc(50% + ${380 + gap}px + (100vw - 1200px) * 0.35)`,
                animationDelay: `-${delay}s`,
              }}
            >
              <span className="tile">
                <Logo src={agent.logo} className={cn(agent.icon && "rounded-[9px]")} />
              </span>
              <span className="name">{agent.name}</span>
            </li>
          );
        })}
      </ul>
      {/* Narrower screens: one row under the headline. */}
      <ul className="mx-auto mt-10 mb-0 flex list-none justify-center gap-[clamp(14px,5vw,56px)] p-0 min-[1200px]:hidden">
        {AGENTS.map((agent) => {
          // Every agent is lit while the headline says "your agents".
          const lit = !current || current === agent;
          return (
            <li
              key={agent.name}
              className={cn(
                "flex flex-col items-center gap-2.5 text-[14px] whitespace-nowrap transition-colors duration-500 max-[420px]:text-[11px]",
                lit ? "text-fg" : "text-fg-4",
              )}
            >
              <Logo
                src={agent.logo}
                className={cn(
                  "size-9 transition-[filter,opacity,translate] duration-500 max-[420px]:size-7",
                  agent.icon && "rounded-[7px]",
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

/** The setup command as a terminal line, with Copy at its side. Clicking anywhere copies it. */
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
        "setup-cmd group/cmd flex items-center gap-4 rounded-[10px] bg-[#0a0a0a] py-2 pr-2 pl-4 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.1)] transition-shadow hover:shadow-[0_0_0_1px_rgba(255,255,255,0.18)]",
        className,
      )}
    >
      <code className="min-w-0 flex-1 break-words font-mono text-[15px] text-fg">
        <span className="text-primary">$ </span>
        {INSTALL_SETUP}
      </code>
      <CopyButton
        value={INSTALL_SETUP}
        installLocation={location}
        icon
        target
        className="prompt-copy h-8 group-focus-within/cmd:bg-primary group-focus-within/cmd:text-primary-foreground group-hover/cmd:bg-primary group-hover/cmd:text-primary-foreground hover:bg-[#c09a45] hover:text-primary-foreground"
      />
    </ClickToCopy>
  );
}

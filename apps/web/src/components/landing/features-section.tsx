"use client";

import { useState } from "react";
import {
  Layers,
  KeyRound,
  MonitorSmartphone,
  Save,
  Globe,
  Share2,
  TerminalSquare,
  Timer,
  Plus,
} from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Pick your cloud",
    body: "Choose the provider that fits each job, from quick sandboxes to infrastructure you already trust.",
  },
  {
    icon: Timer,
    title: "Short task or long run",
    body: "Launch a workspace for one quick job or keep it available for ongoing work. You decide when it stops.",
  },
  {
    icon: KeyRound,
    title: "Set keys once",
    body: "Securely reuse your model and environment credentials without pasting secrets into every workspace.",
  },
  {
    icon: MonitorSmartphone,
    title: "Connect from any device",
    body: "Open the same workspace in your browser or local client and continue exactly where you left off.",
  },
  {
    icon: Save,
    title: "Pause without losing progress",
    body: "Stop active compute, preserve the workspace state, and resume when you are ready to keep going.",
  },
  {
    icon: Globe,
    title: "Share a live app preview",
    body: "Expose any workspace port through a shareable URL for testing, feedback, or a quick demo.",
  },
  {
    icon: Share2,
    title: "Bring your team in",
    body: "Share a workspace with teammates when a task needs another set of eyes or a clean handoff.",
  },
  {
    icon: TerminalSquare,
    title: "Automate with CLI or SDK",
    body: "Create and manage workspaces from scripts, internal tools, or the terminal you already use.",
  },
];

export function FeaturesSection() {
  const [activeFeature, setActiveFeature] = useState(0);

  return (
    <section id="features" className="border-t border-white/[0.06] py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div className="mx-auto mb-10 max-w-xl text-center sm:mx-0 sm:mb-12 sm:text-left">
          <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] font-light leading-[1.04] tracking-tight text-white">
            Built for however you want to{" "}
            <span className="font-display-accent text-[color:var(--cream)]">work</span>.
          </h2>
        </div>

        <div className="flex flex-col gap-2 sm:gap-3">
          {features.map((feature, index) => {
            const active = activeFeature === index;
            const panelId = `feature-panel-${index}`;

            return (
              <div
                key={feature.title}
                onMouseEnter={() => setActiveFeature(index)}
                className="w-full"
              >
                <div
                  className={`overflow-hidden rounded-xl border transition-[width,background-color,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    active
                      ? "w-full border-white/[0.12] bg-card shadow-[0_18px_60px_-36px_rgba(200,164,78,0.4)]"
                      : "w-[calc(100%-1rem)] border-white/[0.06] bg-background shadow-none sm:w-[calc(100%-4rem)]"
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={active}
                    aria-controls={panelId}
                    onClick={() => setActiveFeature(index)}
                    onFocus={() => setActiveFeature(index)}
                    className="group/feature flex w-full cursor-pointer items-center gap-5 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60 sm:gap-6 sm:px-8 sm:py-5"
                  >
                    <span
                      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-[background-color,color,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        active
                          ? "translate-x-2 bg-primary/10 text-primary sm:translate-x-3"
                          : "translate-x-0 bg-white/[0.04] text-primary/70"
                      }`}
                    >
                      <feature.icon className="h-5 w-5" />
                    </span>

                    <h3
                      className={`min-w-0 flex-1 text-[17px] font-medium transition-[color,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] sm:text-xl ${
                        active
                          ? "translate-x-1 text-white sm:translate-x-2"
                          : "translate-x-0 text-white/70 group-hover/feature:text-white/90"
                      }`}
                    >
                      {feature.title}
                    </h3>

                    <span
                      className={`font-mono text-[10px] tracking-[0.18em] transition-[color,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        active ? "translate-x-0 text-primary/55" : "-translate-x-1 text-white/25"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-[border-color,color,transform] duration-500 ${
                        active
                          ? "rotate-45 border-primary/35 text-primary"
                          : "border-white/10 text-white/35"
                      }`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </span>
                  </button>

                  <div
                    id={panelId}
                    aria-hidden={!active}
                    className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      active ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p
                        className={`px-4 pb-5 pl-[80px] text-[14px] leading-[1.7] text-white/50 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-8 sm:pb-6 sm:pl-[104px] sm:text-[15px] ${
                          active
                            ? "translate-x-1 translate-y-0 opacity-100 sm:translate-x-2"
                            : "translate-x-0 -translate-y-3 opacity-0"
                        }`}
                      >
                        {feature.body}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useRef, useState, type ReactNode } from "react";
import { Globe, Monitor, Smartphone } from "lucide-react";
import { T3_LOGO } from "@/lib/site/providers";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

/**
 * Running workspaces, where each one runs and where it is open right now, under the pairing link
 * that connects another device. Pause and Restart work, with a short wait.
 */

type State = "running" | "paused" | "pausing" | "starting";

const icon = "size-3 shrink-0";

const WORKSPACES: {
  id: string;
  repo: string;
  logo: string;
  on: string;
  client: { icon: ReactNode; name: string };
}[] = [
  {
    id: "shop",
    repo: "acme/shop",
    logo: T3_LOGO,
    on: "T3 Code on E2B",
    client: { icon: <Smartphone className={icon} />, name: "iPhone app" },
  },
  {
    id: "admin",
    repo: "acme/admin",
    logo: "/openai-codex.svg",
    on: "Codex in T3 Code on Vercel",
    client: { icon: <Smartphone className={icon} />, name: "Android app" },
  },
  {
    id: "api",
    repo: "acme/api",
    logo: "/opencode.svg",
    on: "OpenCode on Railway",
    client: { icon: <Globe className={icon} />, name: "Web app" },
  },
  {
    id: "docs",
    repo: "acme/docs",
    logo: "/opencode.svg",
    on: "OpenCode on Daytona",
    client: { icon: <Monitor className={icon} />, name: "Desktop app" },
  },
];

const LABEL: Record<State, string> = {
  running: "Running",
  paused: "Paused",
  pausing: "Pausing…",
  starting: "Starting…",
};

export function WorkspacesCard() {
  const [states, setStates] = useState<Record<string, State>>({});
  const timers = useRef<Record<string, number>>({});

  function toggle(id: string) {
    const now = states[id] ?? "running";
    if (now === "pausing" || now === "starting") return;
    const pausing = now === "running";
    setStates((s) => ({ ...s, [id]: pausing ? "pausing" : "starting" }));
    clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(
      () => setStates((s) => ({ ...s, [id]: pausing ? "paused" : "running" })),
      pausing ? 900 : 1600,
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0b0b0e]">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="shrink-0 text-[13px] text-fg-4">Pairing link</span>
        <code className="min-w-0 truncate font-mono text-[12.5px] text-fg-2">
          ws-7k2.gitterm.dev/auth/connect/7QK4M2
        </code>
        <span className="ml-auto shrink-0 text-[12.5px] text-fg-4">5 min</span>
      </div>
      <ul className="m-0 list-none p-0">
        {WORKSPACES.map((w) => {
          const state = states[w.id] ?? "running";
          const busy = state === "pausing" || state === "starting";
          return (
            <li
              key={w.id}
              className="flex items-center gap-3 px-4 py-[15px] [&+&]:border-t [&+&]:border-line"
            >
              <Logo src={w.logo} className="size-5 shrink-0 rounded-[4px] object-contain" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] text-fg">{w.repo}</span>
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-4">
                  {w.on}
                  {/* Where it is open right now; nothing is connected once it pauses */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded bg-fill-2 px-1.5 py-px text-fg-3 transition-opacity",
                      state !== "running" && "opacity-40",
                    )}
                  >
                    {w.client.icon}
                    {w.client.name}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-fg-3">
                <i
                  className={cn(
                    "size-[7px] rounded-full",
                    state === "running" && "bg-[var(--ok)]",
                    state === "paused" && "bg-fg-4",
                    busy && "animate-pulse bg-[var(--warn)]",
                  )}
                />
                {/* Phones keep the dot; the word would push out the provider */}
                <span className="max-[420px]:sr-only">{LABEL[state]}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => toggle(w.id)}
                className="h-7 w-[68px] shrink-0 rounded-md bg-fill-2 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-line-2 hover:text-fg disabled:cursor-default disabled:opacity-50"
              >
                {state === "running" || state === "pausing" ? "Pause" : "Restart"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="m-0 border-t border-line px-4 py-3 text-[12.5px] text-fg-4">
        Idle workspaces pause on their own.
      </p>
    </div>
  );
}

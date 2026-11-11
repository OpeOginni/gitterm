"use client";

import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/site/code-block";

/** Providers that need nothing but a key, so only the name and the variable change. */
const PROVIDERS = [
  { id: "e2b", env: "E2B_API_KEY" },
  { id: "daytona", env: "DAYTONA_API_KEY" },
  { id: "boat", env: "BOAT_API_KEY" },
] as const;

const key = (name: string) => <span className="text-[#a9c1ff]">&quot;{name}&quot;</span>;
const punct = (text: string) => <span className="text-fg-4">{text}</span>;
/** A value that changes with the provider: it fades in each time it does. */
const swap = (text: string, colour: string, id: string) => (
  <span key={id} className={`${colour} motion-safe:animate-[lp-swap_420ms_ease-out]`}>
    &quot;{text}&quot;
  </span>
);

/** The own-key example, cycling through providers. Pauses while hovered or focused. */
export function OwnKeyCode({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % PROVIDERS.length), 2400);
    return () => clearInterval(timer);
  }, [paused]);

  const { id, env } = PROVIDERS[index]!;
  const code = `"options": {\n  "provider": "${id}",\n  "apiKey": "{env:${env}}"\n}`;
  return (
    <div
      className={className}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <CodeBlock code={code} lang="json" copy className="h-full [&_pre]:h-full">
        {key("options")}
        {punct(": {")}
        {"\n  "}
        {key("provider")}
        {punct(": ")}
        {swap(id, "text-[#b9d9a8]", `${id}-name`)}
        {punct(",")}
        {"\n  "}
        {key("apiKey")}
        {punct(": ")}
        {swap(`{env:${env}}`, "text-[#e2c47c]", `${id}-env`)}
        {"\n"}
        {punct("}")}
      </CodeBlock>
    </div>
  );
}

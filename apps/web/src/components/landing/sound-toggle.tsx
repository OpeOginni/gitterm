"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { sound } from "./sound";

/** Turns the demo sounds on or off. Every toggle on the page shares one setting. */
export function SoundToggle() {
  const on = useSyncExternalStore(
    sound.subscribe,
    () => sound.on,
    () => false,
  );
  const Icon = on ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Sound"
      title={on ? "Turn sound off" : "Turn sound on"}
      onClick={() => sound.set(!on)}
      className="inline-flex size-8 items-center justify-center rounded-md border border-line text-fg-3 transition-colors hover:border-line-2 hover:bg-fill hover:text-fg aria-pressed:text-fg-2"
    >
      <Icon className="size-[15px]" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

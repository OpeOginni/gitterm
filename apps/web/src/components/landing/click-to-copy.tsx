"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A box that copies when clicked anywhere: the click is handed to the copy button inside it
 * (marked `data-copy-target`), so the button still shows "Copied". Selecting text inside the
 * box does not copy. Keyboard users reach the button itself.
 */
export function ClickToCopy({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the button inside is the keyboard target
    <div
      className={cn("cursor-pointer", className)}
      onClick={(event) => {
        const button = event.currentTarget.querySelector<HTMLButtonElement>("[data-copy-target]");
        if (!button || button.contains(event.target as Node)) return;
        if (window.getSelection()?.toString()) return;
        button.click();
      }}
    >
      {children}
    </div>
  );
}

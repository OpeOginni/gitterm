"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { trackInstallCopied } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** Small "Copy" button. Shows "Copied" for a moment after a successful copy. */
export function CopyButton({
  value,
  label = "Copy",
  className,
  icon = false,
  installLocation,
  target = false,
}: {
  value: string;
  label?: string;
  className?: string;
  /** Show a copy icon (a check once copied) before the label. */
  icon?: boolean;
  /** Set on plugin install commands, so a copy is counted as a first step. */
  installLocation?: "hero" | "cta";
  /** Marks it as the button a surrounding ClickToCopy box hands its clicks to. */
  target?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-copy-target={target || undefined}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          if (installLocation) trackInstallCopied(value, installLocation);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-md bg-fill-2 px-2.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-white/10 hover:text-fg",
        className,
      )}
    >
      {icon ? (
        // Both states share one grid cell, so the button keeps its width; each state is centred
        // in it, so "Copied" never leaves a gap on one side.
        <span className="grid place-items-center">
          {[false, true].map((done) => {
            const Icon = done ? Check : Copy;
            return (
              <span
                key={String(done)}
                className={cn(
                  "col-start-1 row-start-1 inline-flex items-center gap-1.5",
                  copied !== done && "invisible",
                )}
              >
                <Icon aria-hidden className="size-[15px] shrink-0" />
                <span data-label>{done ? "Copied" : label}</span>
              </span>
            );
          })}
        </span>
      ) : copied ? (
        "Copied"
      ) : (
        label
      )}
    </button>
  );
}

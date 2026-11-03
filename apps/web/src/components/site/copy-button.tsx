"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small "Copy" button. Shows "Copied" for a moment after a successful copy. */
export function CopyButton({
  value,
  label = "Copy",
  className,
  icon = false,
}: {
  value: string;
  label?: string;
  className?: string;
  /** Show a copy icon (a check once copied) before the label. */
  icon?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-md bg-fill-2 px-2.5 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-white/10 hover:text-fg",
        className,
      )}
    >
      {icon && <Icon aria-hidden className="size-[15px] shrink-0" />}
      {icon ? (
        // Both labels share one grid cell, so the button keeps its width when it says "Copied".
        <span className="grid text-left">
          <span className={cn("col-start-1 row-start-1", copied && "invisible")}>{label}</span>
          <span className={cn("col-start-1 row-start-1", !copied && "invisible")}>Copied</span>
        </span>
      ) : copied ? (
        "Copied"
      ) : (
        label
      )}
    </button>
  );
}

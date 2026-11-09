"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * A value to paste somewhere else, such as a URL for another service's settings. Clicking
 * anywhere on it copies it. One line, cut with an ellipsis when long; `multiline` keeps the
 * value's line breaks and wraps long lines at spaces, for commands.
 */
export function CopyField({
  value,
  label,
  multiline = false,
  placeholder = false,
  announceCopied = false,
  className,
}: {
  value: string;
  label?: string;
  multiline?: boolean;
  /** The value is an example, not a real one: shown dimmed. */
  placeholder?: boolean;
  /** The value was copied for the reader, such as by the click that showed it: say so. */
  announceCopied?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  function showCopied(ms = 1600) {
    setCopied(true);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setCopied(false), ms);
  }

  useEffect(() => {
    if (announceCopied) showCopied(2400);
  }, [announceCopied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      showCopied();
    } catch {
      toast.error(`Couldn't copy${label ? ` the ${label.toLowerCase()}` : ""}`);
    }
  }

  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      {label && <p className="text-[13px] font-medium text-fg-2">{label}</p>}
      <button
        type="button"
        onClick={copy}
        title={multiline ? undefined : value}
        aria-label={`Copy ${label ?? "value"}`}
        className={cn(
          "group flex w-full min-w-0 cursor-pointer gap-3 rounded-lg bg-fill-2 py-2 pr-2.5 pl-3 text-left transition-[background-color,box-shadow] duration-300 hover:bg-line-2 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none",
          multiline ? "items-start" : "items-center",
          copied && "ring-1 ring-primary/60",
        )}
      >
        <code
          className={cn(
            "min-w-0 flex-1 font-mono text-[12.5px] leading-relaxed",
            multiline ? "max-h-28 overflow-auto whitespace-pre-wrap" : "truncate",
            placeholder ? "text-fg-4" : "text-fg-2",
          )}
        >
          {value}
        </code>
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-end gap-1.5 text-[12.5px] font-medium transition-colors sm:w-[4.25rem]",
            copied ? "text-primary" : "text-fg-3 group-hover:text-fg",
            multiline && "mt-0.5",
          )}
        >
          {copied ? (
            <Check className="size-3.5 animate-in duration-300 zoom-in-50 fade-in" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span className="max-sm:sr-only">{copied ? "Copied" : "Copy"}</span>
        </span>
      </button>
    </div>
  );
}

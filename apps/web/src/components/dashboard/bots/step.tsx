"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { highlight, type CodeLanguage } from "./highlight";

export type StepState = "done" | "todo" | "optional";

export type StepInfo = {
  id: string;
  title: string;
  state: StepState;
  /** What's chosen so far, or what's still needed. */
  summary?: string;
};

function StepMark({ number, state }: { number: number; state: StepState }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[12.5px] font-medium tabular-nums",
        state === "done" ? "bg-primary/15 text-primary" : "bg-fill-2 text-fg-3",
      )}
    >
      {state === "done" ? <Check className="size-3" /> : number}
    </span>
  );
}

/**
 * The bot so far: progress across the required steps, then each step with what's been chosen.
 * Sticky beside the steps on wide screens, so the choices stay in view while scrolling.
 */
export function SetupSummary({ steps, footer }: { steps: StepInfo[]; footer?: React.ReactNode }) {
  const required = steps.filter((step) => step.state !== "optional");
  const done = required.filter((step) => step.state === "done").length;
  const next = steps.find((step) => step.state === "todo");
  // Phones show the progress and the next step; the full list opens on demand.
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-background">
      <div className="space-y-3.5 px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-fg">
            Your bot
          </span>
          {next ? (
            <span className="text-[12.5px] text-fg-4 tabular-nums">
              {done} of {required.length} required
            </span>
          ) : (
            <span className="text-[12.5px] font-medium text-primary">Ready</span>
          )}
        </div>
        <div className="flex gap-1">
          {required.map((step) => (
            <span
              key={step.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-500",
                step.state === "done"
                  ? "bg-primary"
                  : step === next
                    ? "bg-primary/30"
                    : "bg-fill-2",
              )}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 border-t border-line px-5 py-3 text-left text-[13.5px] transition-colors hover:bg-fill lg:hidden"
      >
        <span className="min-w-0 truncate text-fg-3">
          {next ? (
            <>
              Next: <span className="text-fg">{next.title}</span>
            </>
          ) : (
            "Every required step is done"
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-fg-4">
          {open ? "Hide steps" : "All steps"}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <ol
        className={cn(
          "border-t border-line px-2 py-2 lg:border-t-0 lg:pt-0",
          !open && "hidden lg:block",
        )}
      >
        {steps.map((step, index) => (
          <li key={step.id}>
            <a
              href={`#${step.id}`}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-fill",
                step === next && "bg-fill",
              )}
            >
              <StepMark number={index + 1} state={step.state} />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[13.5px] font-medium",
                    step.state === "done" || step === next ? "text-fg" : "text-fg-2",
                  )}
                >
                  {step.title}
                </span>
                {step.summary ? (
                  <span
                    className={cn(
                      "block truncate text-[12.5px]",
                      step.state === "done" ? "text-fg-3" : "text-fg-4",
                    )}
                  >
                    {step.summary}
                  </span>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ol>
      {/* Wide screens only: phones get the same actions in the page's flow. */}
      {footer ? (
        <div className="hidden space-y-2 border-t border-line p-4 lg:block">{footer}</div>
      ) : null}
    </div>
  );
}

const STATE_LABEL: Record<StepState, string> = {
  done: "Done",
  todo: "Required",
  optional: "Optional",
};

/** One step of the form: a numbered display heading over its fields, no card around it. */
export function Step({
  step,
  number,
  hint,
  children,
}: {
  step: StepInfo;
  number: number;
  /** What's missing, or a one-line summary. */
  hint?: React.ReactNode;
  /** Nothing renders only the header, e.g. a step that waits on an earlier one. */
  children?: React.ReactNode;
}) {
  return (
    <section id={step.id} className="scroll-mt-8 py-9 first:pt-0">
      <div className="flex items-baseline gap-3.5">
        <span className="w-6 shrink-0 font-mono text-[12.5px] text-fg-4 tabular-nums">
          {String(number).padStart(2, "0")}
        </span>
        <h2 className="min-w-0 flex-1 font-display text-[20px] leading-tight font-semibold tracking-[-0.02em] text-fg">
          {step.title}
        </h2>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-[12.5px]",
            step.state === "done" ? "text-primary" : "text-fg-4",
          )}
        >
          {step.state === "done" ? <Check className="size-3.5" /> : null}
          {STATE_LABEL[step.state]}
        </span>
      </div>
      {/* Under the title from `sm` up; phones give the fields the full width. */}
      <div className="sm:pl-[38px]">
        {hint ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-3">{hint}</p> : null}
        {children ? <div className="mt-5">{children}</div> : null}
      </div>
    </section>
  );
}

/** A snippet to copy into a file or a terminal, dark like the landing page's code. */
export function CodeBlock({
  code,
  copyLabel,
  language,
  collapsible = false,
}: {
  code: string;
  copyLabel: string;
  language: CodeLanguage;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };
  const action =
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors hover:bg-fill-2";
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-[#0b0b0e]">
      <div
        className={cn(
          "flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-4",
          open && "border-b border-line",
        )}
      >
        <span className="truncate font-mono text-[12.5px] text-fg-3">{copyLabel}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className={cn(action, "text-fg-3 hover:text-fg")}
            >
              {open ? "Hide" : "Show"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy ${copyLabel}`}
            className={cn(action, copied ? "text-primary" : "text-fg-3 hover:text-fg")}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {open ? (
        <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-[1.7] text-fg-2 [scrollbar-width:thin]">
          {highlight(code, language)}
        </pre>
      ) : null}
    </div>
  );
}

/** A choice tile's frame: a hairline, gold once picked. */
export const choiceTile = (selected: boolean) =>
  cn(
    "rounded-xl border text-left transition-colors",
    selected ? "border-primary/50 bg-fill" : "border-line hover:bg-fill",
  );

export function Radio({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border",
        selected ? "border-primary" : "border-fg-4",
        className,
      )}
    >
      {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

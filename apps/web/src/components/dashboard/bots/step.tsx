"use client";

import type React from "react";
import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
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

function StepMark({
  number,
  state,
  small,
  numbered,
}: {
  number: number;
  state: StepState;
  small?: boolean;
  /** Keep the number when done, for step cards whose check sits on the right. */
  numbered?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium tabular-nums",
        small ? "size-6 text-[12.5px]" : "size-7 text-[13px]",
        state === "done" ? "bg-primary/12 text-[#e2c47c]" : "bg-fill-2 text-fg-3",
      )}
    >
      {state === "done" && !numbered ? <Check className={small ? "size-3" : "size-3.5"} /> : number}
    </span>
  );
}

const STATE_LABEL: Record<StepState, string> = {
  done: "Done",
  todo: "Required",
  optional: "Optional",
};

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
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="space-y-3.5 px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-semibold text-fg">Your bot</span>
          {next ? (
            <span className="text-[12.5px] tabular-nums text-fg-4">
              {done} of {required.length} required
            </span>
          ) : (
            <span className="text-[12.5px] font-medium text-[#e2c47c]">Ready</span>
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
        className="flex w-full items-center justify-between gap-3 border-t border-line px-5 py-3 text-left text-sm lg:hidden"
      >
        <span className="min-w-0 truncate text-fg-2">
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
      <ol className={cn("px-2 pb-2 lg:pt-0", open && "pt-2", !open && "hidden lg:block")}>
        {steps.map((step, index) => (
          <li key={step.id}>
            <a
              href={`#${step.id}`}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-fill",
                step === next && "bg-fill",
              )}
            >
              <StepMark number={index + 1} state={step.state} small />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    step.state === "done" || step === next ? "text-fg" : "text-fg-2",
                  )}
                >
                  {step.title}
                </span>
                {step.summary ? (
                  <span
                    className={cn(
                      "block truncate text-[13px]",
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
      {footer ? <div className="space-y-2 border-t border-line p-4">{footer}</div> : null}
    </div>
  );
}

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
    <SettingsSection
      id={step.id}
      className="scroll-mt-8"
      title={
        <span className="flex items-center gap-3">
          <StepMark number={number} state={step.state} numbered />
          {step.title}
        </span>
      }
      description={hint}
      action={
        step.state === "done" ? (
          <span
            role="img"
            aria-label="Done"
            className="flex size-6 items-center justify-center rounded-full bg-primary/12 text-[#e2c47c]"
          >
            <Check className="size-3.5" />
          </span>
        ) : (
          <span className="text-[12.5px] text-fg-4">{STATE_LABEL[step.state]}</span>
        )
      }
    >
      {children ? (
        <SettingsSectionBody className="px-5 pt-4 pb-5">{children}</SettingsSectionBody>
      ) : null}
    </SettingsSection>
  );
}

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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`${copyLabel} copied`);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };
  return (
    <div className="overflow-hidden rounded-xl bg-[#0b0b0e]">
      <div className="flex items-center justify-between py-1.5 pr-1.5 pl-4">
        <span className="text-[12.5px] text-fg-3">{copyLabel}</span>
        <div className="flex items-center">
          {collapsible ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="h-8 gap-1.5 text-fg-3"
            >
              {open ? "Hide" : "Show"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={copy}
            className="h-8 gap-1.5 text-fg-3"
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      </div>
      {open ? (
        <pre className="overflow-x-auto px-4 pt-1 pb-4 font-mono text-[13px] leading-[1.7] text-fg-2 [scrollbar-width:thin]">
          {highlight(code, language)}
        </pre>
      ) : null}
    </div>
  );
}

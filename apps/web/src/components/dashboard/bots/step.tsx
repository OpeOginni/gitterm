"use client";

import type React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import { cn } from "@/lib/utils";

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
        "flex shrink-0 items-center justify-center rounded-full border font-mono",
        small ? "size-5 text-[10px]" : "size-6 text-[11px]",
        state === "done" ? "border-primary/40 bg-primary/10 text-primary" : "border-line text-fg-3",
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

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="space-y-3.5 px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            Your bot
          </span>
          {next ? (
            <span className="font-mono text-[11px] tabular-nums text-fg-4">
              {done}/{required.length} required
            </span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
              Ready
            </span>
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
      <ol className="border-t border-line">
        {steps.map((step, index) => (
          <li key={step.id}>
            <a
              href={`#${step.id}`}
              className={cn(
                "relative flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-fill",
                step === next && "bg-fill",
              )}
            >
              {step === next ? (
                <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
              ) : null}
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
                      step.state === "done" ? "font-mono text-fg-3" : "text-fg-4",
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
  children: React.ReactNode;
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
            className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-primary"
          >
            <Check className="size-3.5" />
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-4">
            {STATE_LABEL[step.state]}
          </span>
        )
      }
    >
      <SettingsSectionBody className="px-5 py-4">{children}</SettingsSectionBody>
    </SettingsSection>
  );
}

export function CodeBlock({ code, copyLabel }: { code: string; copyLabel: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`${copyLabel} copied`);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-line bg-fill p-4 pr-24 font-mono text-xs leading-relaxed text-fg-2">
        {code}
      </pre>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={copy}
        className="absolute top-2.5 right-2.5 h-7 gap-1.5 text-xs"
      >
        <Copy className="size-3.5" />
        Copy
      </Button>
    </div>
  );
}

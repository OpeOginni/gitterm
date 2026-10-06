"use client";

import type React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import { cn } from "@/lib/utils";

export type StepState = "done" | "todo" | "optional";

export type StepInfo = { id: string; title: string; state: StepState };

function StepMark({ number, state, small }: { number: number; state: StepState; small?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border font-mono",
        small ? "size-5 text-[10px]" : "size-6 text-[11px]",
        state === "done" ? "border-primary/40 bg-primary/10 text-primary" : "border-line text-fg-3",
      )}
    >
      {state === "done" ? <Check className={small ? "size-3" : "size-3.5"} /> : number}
    </span>
  );
}

const STATE_LABEL: Record<StepState, string> = {
  done: "Done",
  todo: "Required",
  optional: "Optional",
};

export function StepProgress({ steps }: { steps: StepInfo[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {steps.map((step, index) => (
        <li key={step.id}>
          <a
            href={`#${step.id}`}
            className={cn(
              "flex items-center gap-2 text-xs transition-colors hover:text-fg",
              step.state === "done" ? "text-fg-2" : "text-fg-4",
            )}
          >
            <StepMark number={index + 1} state={step.state} small />
            {step.title}
          </a>
        </li>
      ))}
    </ol>
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
      className="scroll-mt-24"
      title={
        <span className="flex items-center gap-3">
          <StepMark number={number} state={step.state} />
          {step.title}
        </span>
      }
      description={hint}
      action={
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.16em]",
            step.state === "done" ? "text-primary" : "text-fg-4",
          )}
        >
          {STATE_LABEL[step.state]}
        </span>
      }
    >
      <SettingsSectionBody>{children}</SettingsSectionBody>
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

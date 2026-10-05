"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { getIcon } from "../create-instance/types";

export type ComputeOption = { key: string; name: string };

const tileClass =
  "flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors";

/** Where new sandboxes run. Your default is pre-selected; regions and sizes stay default. */
export function ComputeStepBody({
  options,
  selected,
  defaultKey,
  onSelect,
}: {
  options: ComputeOption[];
  selected: string | null;
  defaultKey: string | null;
  onSelect: (provider: string) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup">
      {options.map((option) => {
        const isSelected = option.key === selected;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(option.key)}
            className={cn(
              tileClass,
              isSelected
                ? "border-primary/60 bg-fill"
                : "border-line hover:border-fg-4 hover:bg-fill",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-fill-2">
              <Image
                src={getIcon(option.key)}
                alt=""
                width={18}
                height={18}
                className="size-[18px] object-contain"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{option.name}</span>
              {option.key === defaultKey ? (
                <span className="block text-[13px] text-fg-3">Your default</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

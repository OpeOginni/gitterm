"use client";

import Image from "next/image";
import { Cloud } from "lucide-react";
import type { WorkspaceType } from "./types";

interface WorkspaceTypeSelectorProps {
  value: WorkspaceType;
  onChange: (type: WorkspaceType) => void;
}

interface WorkspaceOption {
  type: WorkspaceType;
  label: string;
  description: string;
  disabled: boolean;
}

const workspaceOptions: WorkspaceOption[] = [
  {
    type: "cloud",
    label: "Cloud Instance",
    description: "Remote workspace",
    disabled: false,
  },
  {
    type: "agentic-loops",
    label: "Agentic Loops",
    description: "Autonomous Loops",
    disabled: true,
  },
];

export function WorkspaceTypeSelector({ value, onChange }: WorkspaceTypeSelectorProps) {
  return (
    <div className="grid gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
        Workspace Type
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {workspaceOptions.map((option) => {
          const isSelected = value === option.type;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => !option.disabled && onChange(option.type)}
              className={`relative flex items-center gap-3 rounded-xl border p-4 transition-all ${
                option.disabled
                  ? "cursor-not-allowed border-white/[0.04] bg-white/[0.01]"
                  : isSelected
                    ? "border-primary/30 bg-primary/[0.06]"
                    : "border-border hover:border-white/[0.12] hover:bg-white/[0.03]"
              }`}
              disabled={option.disabled}
            >
              {option.disabled && (
                <span className="absolute -top-2 right-3 rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/25">
                  Rework Ongoing
                </span>
              )}
              {option.type === "cloud" ? (
                <Cloud className={`h-5 w-5 ${isSelected ? "text-primary" : "text-white/30"}`} />
              ) : (
                <Image
                  src="/ralph-wiggum.svg"
                  alt="Ralph Wiggum"
                  width={20}
                  height={20}
                  className={`h-5 w-5 ${option.disabled ? "opacity-20 grayscale" : isSelected ? "opacity-100" : "opacity-40"}`}
                />
              )}
              <div className="text-left">
                <p
                  className={`text-sm font-medium ${option.disabled ? "text-white/20" : isSelected ? "text-white" : "text-white/60"}`}
                >
                  {option.label}
                </p>
                <p className={`text-xs ${option.disabled ? "text-white/15" : "text-white/30"}`}>
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

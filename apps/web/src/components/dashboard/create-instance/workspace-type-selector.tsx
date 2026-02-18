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
}

const workspaceOptions: WorkspaceOption[] = [
  {
    type: "cloud",
    label: "Cloud Instance",
    description: "Remote workspace",
  },
  {
    type: "agentic-loops",
    label: "Agentic Loops",
    description: "Autonomous Loops",
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
              onClick={() => onChange(option.type)}
              className={`flex items-center gap-3 rounded-xl border p-4 transition-all ${
                isSelected
                  ? "border-primary/30 bg-primary/[0.06]"
                  : "border-border hover:border-white/[0.12] hover:bg-white/[0.03]"
              }`}
            >
              {option.type === "cloud" ? (
                <Cloud
                  className={`h-5 w-5 ${isSelected ? "text-primary" : "text-white/30"}`}
                />
              ) : (
                <Image
                  src="/ralph-wiggum.svg"
                  alt="Ralph Wiggum"
                  width={20}
                  height={20}
                  className={`h-5 w-5 ${isSelected ? "opacity-100" : "opacity-40"}`}
                />
              )}
              <div className="text-left">
                <p
                  className={`text-sm font-medium ${isSelected ? "text-white" : "text-white/60"}`}
                >
                  {option.label}
                </p>
                <p className="text-xs text-white/30">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import { Cloud } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { WorkspaceType } from "./types";

interface WorkspaceTypeSelectorProps {
  value: WorkspaceType;
  onChange: (type: WorkspaceType) => void;
}

interface WorkspaceOption {
  type: WorkspaceType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const workspaceOptions: WorkspaceOption[] = [
  {
    type: "cloud",
    label: "Cloud Instance",
    description: "Remote workspace",
    icon: null, // Will use Cloud icon
  },
  {
    type: "agentic-loops",
    label: "Agentic Loops",
    description: "Autonomous Loops",
    icon: null, // Will use custom SVG
  },
];

export function WorkspaceTypeSelector({ value, onChange }: WorkspaceTypeSelectorProps) {
  const renderIcon = (option: WorkspaceOption, isSelected: boolean) => {
    const iconClass = `h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`;

    switch (option.type) {
      case "cloud":
        return <Cloud className={iconClass} />;
      case "agentic-loops":
        return (
          <Image
            src="/ralph-wiggum.svg"
            alt="Ralph Wiggum"
            width={20}
            height={20}
            className={`h-5 w-5 ${isSelected ? "opacity-100" : "opacity-60"}`}
          />
        );
      default:
        return <Cloud className={iconClass} />;
    }
  };

  return (
    <div className="grid gap-2">
      <Label className="text-sm font-medium">Workspace Type</Label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {workspaceOptions.map((option) => {
          const isSelected = value === option.type;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => onChange(option.type)}
              className={`flex items-start gap-3 p-4 rounded-lg border transition-all sm:items-center ${
                isSelected
                  ? "border-accent bg-primary/10"
                  : "border-border/50 hover:border-border hover:bg-secondary"
              }`}
            >
              {renderIcon(option, isSelected)}
              <div className="text-left">
                <p className={`text-sm font-medium ${isSelected ? "text-foreground" : ""}`}>
                  {option.label}
                </p>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

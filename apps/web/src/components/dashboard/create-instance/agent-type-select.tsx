"use client";

import Image from "next/image";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getIcon, type AgentType } from "./types";

interface AgentTypeSelectProps {
  value: string;
  onChange: (value: string) => void;
  agentTypes: AgentType[];
  label?: string;
  description?: string;
}

export function AgentTypeSelect({
  value,
  onChange,
  agentTypes,
  label = "Agent Type",
  description,
}: AgentTypeSelectProps) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-medium">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-secondary/30 border-border/50">
          <SelectValue placeholder="Select agent" />
        </SelectTrigger>
        <SelectContent>
          {agentTypes.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              <div className="flex items-center">
                <Image
                  src={getIcon(agent.name) || "/placeholder.svg"}
                  alt={agent.name}
                  width={16}
                  height={16}
                  className="mr-2 h-4 w-4"
                />
                {agent.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

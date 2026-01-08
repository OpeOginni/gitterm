"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODEL_PROVIDERS, getModelsForProvider } from "./types";

interface ModelProviderSelectProps {
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export function ModelProviderSelect({
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
}: ModelProviderSelectProps) {
  const availableModels = useMemo(() => {
    return getModelsForProvider(selectedProvider);
  }, [selectedProvider]);

  const handleProviderChange = (providerId: string) => {
    onProviderChange(providerId);
    // Auto-select first model when provider changes
    const models = getModelsForProvider(providerId);
    if (models.length > 0) {
      onModelChange(models[0].id);
    } else {
      onModelChange("");
    }
  };

  return (
    <>
      {/* Provider and Model Selection - Side by Side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Provider Selection */}
        <div className="grid gap-2">
          <Label className="text-sm font-medium">AI Provider</Label>
          <Select value={selectedProvider} onValueChange={handleProviderChange}>
            <SelectTrigger className="bg-secondary/30 border-border/50">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {MODEL_PROVIDERS.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Model Selection */}
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Model</Label>
          <Select
            value={selectedModel}
            onValueChange={onModelChange}
            disabled={!selectedProvider || availableModels.length === 0}
          >
            <SelectTrigger className="bg-secondary/30 border-border/50">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <div className="flex items-center gap-2">
                    {model.name}
                    {model.requiresApiKey === false && (
                      <span className="text-xs bg-green-500/20 text-green-600 px-1.5 py-0.5 rounded">
                        Free
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        API keys will be provided when starting each run from the Agent Loops dashboard.
      </p>
    </>
  );
}

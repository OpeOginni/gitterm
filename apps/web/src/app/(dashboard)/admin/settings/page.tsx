"use client";

import { useState, useEffect } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow } from "@/components/dashboard/kit";
import { useAdminGuard } from "../_components/admin";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSaveBar } from "@/components/dashboard/settings/settings-page";
import { trpcClient } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface SettingValue {
  key: string;
  value: number;
  label: string;
  description: string;
  min: number;
  max: number;
}

/** Sentence-case labels and units for the server's settings, by key. */
const COPY: Record<string, { label: string; unit: string }> = {
  idle_timeout_minutes: { label: "Idle timeout", unit: "minutes" },
  free_tier_daily_minutes: { label: "Free daily minutes", unit: "minutes a day" },
};

export default function SettingsPage() {
  const { ready } = useAdminGuard();
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, number>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => trpcClient.admin.settings.get.query(),
    enabled: ready,
  });

  // Initialize form values when data loads
  useEffect(() => {
    if (data?.settings) {
      const values: Record<string, number> = {};
      data.settings.forEach((setting: SettingValue) => {
        values[setting.key] = setting.value;
      });
      setFormValues(values);
      setHasChanges(false);
    }
  }, [data]);

  const updateSettings = useMutation({
    mutationFn: (params: { idle_timeout_minutes?: number; free_tier_daily_minutes?: number }) =>
      trpcClient.admin.settings.update.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast.success("Settings saved");
      setHasChanges(false);
    },
    onError: (error) => toast.error(error.message),
  });

  const handleValueChange = (key: string, value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue)) {
      setFormValues((prev) => ({ ...prev, [key]: numValue }));
      setHasChanges(true);
    }
  };

  const handleSave = () => {
    updateSettings.mutate({
      idle_timeout_minutes: formValues.idle_timeout_minutes,
      free_tier_daily_minutes: formValues.free_tier_daily_minutes,
    });
  };

  const handleReset = () => {
    if (data?.settings) {
      const values: Record<string, number> = {};
      data.settings.forEach((setting: SettingValue) => {
        values[setting.key] = setting.value;
      });
      setFormValues(values);
      setHasChanges(false);
    }
  };

  return (
    <DashboardShell>
      <DashboardHeader heading="System settings" text="Limits that apply to every workspace." />

      {!ready || isLoading ? (
        <Panel>
          {[...Array(2)].map((_, i) => (
            <PanelRow key={i} className="block space-y-2 py-5">
              <Skeleton className="h-4 w-40 bg-fill" />
              <Skeleton className="h-3.5 w-72 bg-fill" />
            </PanelRow>
          ))}
        </Panel>
      ) : (
        <Panel>
          {data?.settings.map((setting: SettingValue) => {
            const copy = COPY[setting.key];
            return (
              <div
                key={setting.key}
                className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={setting.key} className="text-[14px] font-medium text-fg">
                    {copy?.label ?? setting.label}
                  </Label>
                  <p className="max-w-xl text-[13px] leading-relaxed text-fg-3">
                    {setting.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Input
                    id={setting.key}
                    type="number"
                    min={setting.min}
                    max={setting.max}
                    value={formValues[setting.key] ?? setting.value}
                    onChange={(e) => handleValueChange(setting.key, e.target.value)}
                    className="w-24 font-mono tabular-nums"
                  />
                  <div className="w-32">
                    <p className="text-[13px] text-fg-2">{copy?.unit ?? "minutes"}</p>
                    <p className="text-[12.5px] text-fg-4 tabular-nums">
                      {setting.min} to {setting.max}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      <SettingsSaveBar
        visible={hasChanges}
        saving={updateSettings.isPending}
        onSave={handleSave}
        onCancel={handleReset}
      />
    </DashboardShell>
  );
}

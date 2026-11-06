"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsGroup, SettingsSaveBar } from "@/components/dashboard/settings/settings-page";
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

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, number>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!isSessionPending) {
      if (!session?.user) {
        router.push("/login");
        return;
      }
      const userRole = (session.user as any)?.role;
      if (userRole !== "admin") {
        router.push("/dashboard");
        return;
      }
    }
  }, [session?.user, isSessionPending, router]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => trpcClient.admin.settings.get.query(),
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
      toast.success("Settings saved successfully");
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

  // Don't render content if not authenticated or not admin (will redirect)
  if (isSessionPending || !session?.user || (session.user as any)?.role !== "admin") {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="System settings"
        text="Configure system-wide settings for workspaces and quotas."
      />

      {isLoading ? (
        <div className="space-y-3 rounded-2xl bg-card p-6">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="space-y-2 py-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-72" />
            </div>
          ))}
        </div>
      ) : (
        <SettingsGroup bodyClassName="py-1">
          <div className="divide-y divide-line">
            {data?.settings.map((setting: SettingValue) => (
              <div
                key={setting.key}
                className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={setting.key} className="text-[15px] font-medium text-fg">
                    {setting.label}
                  </Label>
                  <p className="max-w-xl text-[13.5px] leading-relaxed text-fg-3">
                    {setting.description}
                  </p>
                  <p className="text-[12.5px] text-fg-4">
                    Range: {setting.min} - {setting.max}
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
                    className="w-28"
                  />
                  <span className="w-28 text-[13.5px] text-fg-3">
                    {setting.key === "idle_timeout_minutes" ? "minutes" : "minutes per day"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SettingsGroup>
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

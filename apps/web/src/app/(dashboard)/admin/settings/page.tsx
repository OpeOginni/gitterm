"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import type { Route } from "next";

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
  }, [session?.user, isSessionPending]);

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
        heading="System Settings"
        text="Configure system-wide settings for workspaces and quotas."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin" as Route}>Back to Admin</Link>
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateSettings.isPending}
            className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateSettings.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DashboardHeader>

      <div className="pt-2 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-6 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-10 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {data?.settings.map((setting: SettingValue) => (
              <div key={setting.key} className="rounded-2xl border border-border bg-card p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-white/[0.04] p-2.5">
                    <Settings className="h-5 w-5 text-white/40" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={setting.key} className="text-base font-medium text-white/90">
                      {setting.label}
                    </Label>
                    <p className="text-sm text-white/40">{setting.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 pl-14">
                  <Input
                    id={setting.key}
                    type="number"
                    min={setting.min}
                    max={setting.max}
                    value={formValues[setting.key] ?? setting.value}
                    onChange={(e) => handleValueChange(setting.key, e.target.value)}
                    className="w-32"
                  />
                  <span className="text-sm text-white/40">
                    {setting.key === "idle_timeout_minutes" ? "minutes" : "minutes per day"}
                  </span>
                  <span className="text-xs text-white/25 ml-auto">
                    Range: {setting.min} - {setting.max}
                  </span>
                </div>
              </div>
            ))}

            {hasChanges && (
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/[0.06]">
                <Button variant="outline" onClick={handleReset}>
                  Reset
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateSettings.isPending}
                  className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateSettings.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

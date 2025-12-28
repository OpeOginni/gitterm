"use client"

import { useState, useEffect } from "react"
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Settings, Save } from "lucide-react"
import { trpcClient } from "@/utils/trpc"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import Link from "next/link"
import type { Route } from "next"

interface SettingValue {
  key: string
  value: number
  label: string
  description: string
  min: number
  max: number
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [formValues, setFormValues] = useState<Record<string, number>>({})
  const [hasChanges, setHasChanges] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => trpcClient.admin.settings.get.query(),
  })

  // Initialize form values when data loads
  useEffect(() => {
    if (data?.settings) {
      const values: Record<string, number> = {}
      data.settings.forEach((setting: SettingValue) => {
        values[setting.key] = setting.value
      })
      setFormValues(values)
      setHasChanges(false)
    }
  }, [data])

  const updateSettings = useMutation({
    mutationFn: (params: { idle_timeout_minutes?: number; free_tier_daily_minutes?: number }) =>
      trpcClient.admin.settings.update.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] })
      toast.success("Settings saved successfully")
      setHasChanges(false)
    },
    onError: (error) => toast.error(error.message),
  })

  const handleValueChange = (key: string, value: string) => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue)) {
      setFormValues((prev) => ({ ...prev, [key]: numValue }))
      setHasChanges(true)
    }
  }

  const handleSave = () => {
    updateSettings.mutate({
      idle_timeout_minutes: formValues.idle_timeout_minutes,
      free_tier_daily_minutes: formValues.free_tier_daily_minutes,
    })
  }

  const handleReset = () => {
    if (data?.settings) {
      const values: Record<string, number> = {}
      data.settings.forEach((setting: SettingValue) => {
        values[setting.key] = setting.value
      })
      setFormValues(values)
      setHasChanges(false)
    }
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
          >
            <Save className="h-4 w-4 mr-2" />
            {updateSettings.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DashboardHeader>

      <div className="pt-8 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="p-6 border rounded-lg space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-10 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {data?.settings.map((setting: SettingValue) => (
              <div
                key={setting.key}
                className="p-6 border rounded-lg space-y-4"
              >
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-md bg-muted/50">
                    <Settings className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={setting.key} className="text-base font-medium">
                      {setting.label}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {setting.description}
                    </p>
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
                  <span className="text-sm text-muted-foreground">
                    {setting.key === "idle_timeout_minutes" ? "minutes" : "minutes per day"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    Range: {setting.min} - {setting.max}
                  </span>
                </div>
              </div>
            ))}

            {hasChanges && (
              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={handleReset}>
                  Reset
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateSettings.isPending}
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
  )
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Lock } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ProviderConfigField {
  fieldName: string;
  fieldLabel: string;
  fieldType: "text" | "password" | "number" | "select" | "url" | "boolean";
  isRequired: boolean;
  isEncrypted: boolean;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  sortOrder: number;
}

export default function ProviderSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const providerId = useMemo(() => {
    const param = params?.providerId;
    return Array.isArray(param) ? param[0] : param;
  }, [params]);

  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();

  const [providerName, setProviderName] = useState("");
  const [selectedProviderTypeId, setSelectedProviderTypeId] = useState("");
  const [configForm, setConfigForm] = useState<Record<string, any>>({});
  const [configName, setConfigName] = useState("");
  const [configEnabled, setConfigEnabled] = useState(true);
  const [newRegion, setNewRegion] = useState({
    name: "",
    location: "",
    externalRegionIdentifier: "",
  });

  const { data: provider, isLoading: isLoadingProvider } = useQuery({
    queryKey: ["admin", "provider", providerId],
    queryFn: () => trpcClient.admin.infrastructure.getProvider.query({ id: providerId as string }),
    enabled: !!providerId,
  });

  const { data: providerTypes } = useQuery({
    queryKey: ["admin", "providerTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listProviderTypes.query(),
  });

  const { data: selectedProviderFields, isLoading: isLoadingFields } = useQuery({
    queryKey: ["admin", "providerConfigFields", selectedProviderTypeId],
    queryFn: () =>
      trpcClient.admin.infrastructure.getProviderConfigFields.query({
        providerTypeId: selectedProviderTypeId,
      }),
    enabled: !!selectedProviderTypeId,
  });

  const updateProvider = useMutation({
    mutationFn: (params: { id: string; providerConfigId?: string | null; name?: string }) =>
      trpcClient.admin.infrastructure.updateProvider.mutate(params),
  });

  const toggleProvider = useMutation({
    mutationFn: (params: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleProvider.mutate(params),
  });

  const createProviderConfig = useMutation({
    mutationFn: (params: {
      providerTypeId: string;
      name: string;
      config: Record<string, any>;
      isDefault: boolean;
    }) => trpcClient.admin.infrastructure.createProviderConfig.mutate(params),
  });

  const updateProviderConfig = useMutation({
    mutationFn: (params: { id: string; name?: string; config?: Record<string, any> }) =>
      trpcClient.admin.infrastructure.updateProviderConfig.mutate(params),
  });

  const toggleProviderConfig = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleProviderConfig.mutate({ id, isEnabled }),
  });

  const createRegion = useMutation({
    mutationFn: (params: {
      cloudProviderId: string;
      name: string;
      location: string;
      externalRegionIdentifier: string;
    }) => trpcClient.admin.infrastructure.createRegion.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
      setNewRegion({ name: "", location: "", externalRegionIdentifier: "" });
      toast.success("Region created");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleRegion = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleRegion.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
      toast.success(`Region ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const findProviderTypeId = (providerNameValue: string) =>
    providerTypes?.find(
      (type) => type.name.toLowerCase() === providerNameValue.trim().toLowerCase(),
    )?.id ?? "";

  const selectedProviderType = providerTypes?.find((type) => type.id === selectedProviderTypeId);

  const isSavingConfig =
    createProviderConfig.isPending ||
    updateProviderConfig.isPending ||
    updateProvider.isPending ||
    toggleProviderConfig.isPending ||
    toggleProvider.isPending;

  useEffect(() => {
    if (!isSessionPending) {
      if (!session?.user) {
        router.push("/login");
        return;
      }
      const userRole = (session.user as any)?.role;
      if (userRole !== "admin") {
        router.push("/dashboard");
      }
    }
  }, [session?.user, isSessionPending, router]);

  useEffect(() => {
    if (!provider) {
      return;
    }

    setProviderName(provider.name ?? "");
    setConfigName(provider.providerConfig?.name ?? `${provider.name} Default`);
    setConfigForm(provider.providerConfig?.config ?? {});
    setConfigEnabled(provider.providerConfig?.isEnabled ?? true);
  }, [provider?.id]);

  useEffect(() => {
    if (!provider || selectedProviderTypeId) {
      return;
    }

    const providerTypeId =
      provider.providerConfig?.providerTypeId ?? findProviderTypeId(provider.name);

    if (providerTypeId) {
      setSelectedProviderTypeId(providerTypeId);
    }
  }, [provider, providerTypes, selectedProviderTypeId]);

  useEffect(() => {
    if (!selectedProviderFields) {
      return;
    }

    setConfigForm((current) => {
      const next = { ...current };
      selectedProviderFields.forEach((field) => {
        if (next[field.fieldName] === undefined && field.defaultValue !== undefined) {
          next[field.fieldName] = field.defaultValue;
        }
      });
      return next;
    });
  }, [selectedProviderFields]);

  const handleToggleProvider = async () => {
    if (!provider) {
      return;
    }
    try {
      const newEnabledState = !provider.isEnabled;
      await toggleProvider.mutateAsync({ id: provider.id, isEnabled: newEnabledState });
      toast.success(`Provider ${newEnabledState ? "enabled" : "disabled"}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle provider");
      console.error("Failed to toggle provider", error);
    }
  };

  const handleSaveSettings = async () => {
    if (!provider || !selectedProviderTypeId) {
      toast.error("Select a provider to configure.");
      return;
    }

    const name = configName.trim() || `${provider.name} Default`;
    const nextProviderName = providerName.trim() || provider.name;
    const existingConfigId = provider.providerConfig?.id as string | undefined;

    try {
      let configId = existingConfigId;
      if (existingConfigId) {
        await updateProviderConfig.mutateAsync({
          id: existingConfigId,
          name,
          config: configForm,
        });
      } else {
        const created = await createProviderConfig.mutateAsync({
          providerTypeId: selectedProviderTypeId,
          name,
          config: configForm,
          isDefault: true,
        });
        configId = created.id;
        await updateProvider.mutateAsync({
          id: provider.id,
          providerConfigId: created.id,
        });
      }

      if (configId && provider.providerConfig?.isEnabled !== configEnabled) {
        await toggleProviderConfig.mutateAsync({ id: configId, isEnabled: configEnabled });
      }

      if (nextProviderName !== provider.name) {
        await updateProvider.mutateAsync({
          id: provider.id,
          name: nextProviderName,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
      toast.success("Provider settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save provider settings");
    }
  };

  const renderField = (field: ProviderConfigField) => {
    const value = configForm[field.fieldName] ?? field.defaultValue ?? "";

    if (field.fieldType === "password") {
      return (
        <div key={field.fieldName} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && <span className="text-destructive">*</span>}
            </Label>
            {field.isEncrypted && <Lock className="h-3 w-3 text-white/30" />}
          </div>
          <Input
            id={field.fieldName}
            type="password"
            placeholder={field.fieldLabel}
            value={value}
            onChange={(e) =>
              setConfigForm({ ...configForm, [field.fieldName]: e.target.value })
            }
            required={field.isRequired}
          />
        </div>
      );
    }

    if (field.fieldType === "boolean") {
      return (
        <div key={field.fieldName} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && <span className="text-destructive">*</span>}
            </Label>
            {field.isEncrypted && <Lock className="h-3 w-3 text-white/30" />}
          </div>
          <Switch
            id={field.fieldName}
            checked={value}
            onCheckedChange={(checked) =>
              setConfigForm({ ...configForm, [field.fieldName]:checked })
            }
          />
        </div>
      );
    }

    if (field.fieldType === "select" && field.options) {
      return (
        <div key={field.fieldName} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && <span className="text-destructive">*</span>}
            </Label>
            {field.isEncrypted && <Lock className="h-3 w-3 text-white/30" />}
          </div>
          <Select
            value={value}
            onValueChange={(val) =>
              setConfigForm({ ...configForm, [field.fieldName]: val })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${field.fieldLabel}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div key={field.fieldName} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={field.fieldName}>
            {field.fieldLabel}
            {field.isRequired && <span className="text-destructive">*</span>}
          </Label>
          {field.isEncrypted && <Lock className="h-3 w-3 text-white/30" />}
        </div>
        <Input
          id={field.fieldName}
          type={field.fieldType === "number" ? "number" : field.fieldType}
          placeholder={field.fieldLabel}
          value={value}
          onChange={(e) =>
            setConfigForm({ ...configForm, [field.fieldName]: e.target.value })
          }
          required={field.isRequired}
        />
      </div>
    );
  };

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
        heading={provider ? `${provider.name} Settings` : "Provider Settings"}
        text="Manage credentials, naming, enablement, and regions for this provider."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin/providers" as Route}>Back to Providers</Link>
          </Button>
          <Button
            onClick={handleSaveSettings}
            disabled={!selectedProviderTypeId || isSavingConfig}
            className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
          >
            {isSavingConfig ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </DashboardHeader>

      <div className="pt-2 space-y-6">
        {isLoadingProvider ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-52 w-full" />
            <Skeleton className="h-52 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Provider Section */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-white/90">Provider</p>
                  <p className="text-xs text-white/40">
                    Update the display name and enablement for this provider.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-white/40">Enabled</Label>
                  <Switch checked={provider?.isEnabled} onCheckedChange={handleToggleProvider} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="provider-name">Provider Name</Label>
                  <Input
                    id="provider-name"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    placeholder="e.g., Railway"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider Type</Label>
                  <Input value={selectedProviderType?.displayName ?? "Unknown"} disabled readOnly />
                </div>
              </div>
            </div>

            {/* Credentials & Config Section */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-white/90">Credentials & Config</p>
                  <p
                    className={cn(
                      "text-xs",
                      provider?.providerConfig
                        ? provider.providerConfig.isEnabled
                          ? "text-emerald-400"
                          : "text-white/30"
                        : "text-amber-400"
                    )}
                  >
                    {provider?.providerConfig
                      ? provider.providerConfig.isEnabled
                        ? "Active and ready"
                        : "Saved but disabled"
                      : "Missing configurations"}
                  </p>
                </div>
              </div>

              {!selectedProviderTypeId && (
                <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-4 text-sm text-white/40">
                  No provider definition found for this entry. Make sure the provider name matches a
                  registered provider type.
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="config-name">Configuration Name</Label>
                  <Input
                    id="config-name"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="e.g., Railway Production"
                  />
                </div>

              </div>

              {selectedProviderTypeId && isLoadingFields && (
                <div className="mt-4 space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}

              {selectedProviderTypeId && selectedProviderFields && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {selectedProviderFields
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map(renderField)}
                </div>
              )}
            </div>

            {/* Regions Section */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-white/90">Regions</p>
                  <p className="text-xs text-white/40">
                    Enable, disable, or add regions for this provider.
                  </p>
                </div>
                <Badge variant="outline" className="border-white/[0.08] bg-white/[0.04] text-white/40 text-xs">
                  {provider?.regions?.length ?? 0} total
                </Badge>
              </div>

              <div className="mt-4 space-y-2">
                {provider?.regions?.length ? (
                  provider.regions.map((region: any) => (
                    <div
                      key={region.id}
                      className={`flex items-center justify-between rounded-xl border border-border bg-white/[0.02] px-4 py-3 ${
                        !region.isEnabled ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-white/[0.04] p-2">
                          <MapPin className="h-4 w-4 text-white/40" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white/90">{region.name}</span>
                            {!region.isEnabled && (
                              <Badge
                                variant="outline"
                                className="border-white/[0.08] bg-white/[0.04] text-white/40 text-xs"
                              >
                                Disabled
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-white/30">
                            {region.location} • {region.externalRegionIdentifier}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={region.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleRegion.mutate({ id: region.id, isEnabled: checked })
                        }
                      />
                    </div>
                  ))
                ) : (
                  <p className="py-12 text-center text-white/30">No regions configured yet.</p>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-5">
                <p className="text-sm font-medium text-white/90">Add Region</p>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="region-name">Region Name</Label>
                    <Input
                      id="region-name"
                      value={newRegion.name}
                      onChange={(e) => setNewRegion({ ...newRegion, name: e.target.value })}
                      placeholder="e.g., US West"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={newRegion.location}
                      onChange={(e) => setNewRegion({ ...newRegion, location: e.target.value })}
                      placeholder="e.g., California"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="external-id">External Identifier</Label>
                    <Input
                      id="external-id"
                      value={newRegion.externalRegionIdentifier}
                      onChange={(e) =>
                        setNewRegion({ ...newRegion, externalRegionIdentifier: e.target.value })
                      }
                      placeholder="e.g., us-west-2"
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!provider?.id) {
                        toast.error("Select a provider first.");
                        return;
                      }
                      createRegion.mutate({
                        cloudProviderId: provider.id,
                        ...newRegion,
                      });
                    }}
                    disabled={
                      !newRegion.name ||
                      !newRegion.location ||
                      !newRegion.externalRegionIdentifier ||
                      createRegion.isPending
                    }
                  >
                    {createRegion.isPending ? "Adding..." : "Add Region"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

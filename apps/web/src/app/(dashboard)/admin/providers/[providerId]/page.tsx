"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2, Lock, MapPin, RefreshCw, Trash2, Wand2 } from "lucide-react";
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

interface AwsSetupSummary {
  stackName: string;
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
  const [allowUserRegionSelection, setAllowUserRegionSelection] = useState(true);
  const [selectedProviderTypeId, setSelectedProviderTypeId] = useState("");
  const [configForm, setConfigForm] = useState<Record<string, any>>({});
  const [configName, setConfigName] = useState("");
  const [configEnabled, setConfigEnabled] = useState(true);
  const [awsSetupSummary, setAwsSetupSummary] = useState<AwsSetupSummary | null>(null);
  const [awsActionDialog, setAwsActionDialog] = useState<"delete" | "reset" | null>(null);
  const [isResettingAwsInfrastructure, setIsResettingAwsInfrastructure] = useState(false);
  const [newRegion, setNewRegion] = useState({
    name: "",
    location: "",
    externalRegionIdentifier: "",
  });

  const refreshProviderQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
  };

  const applyAwsBootstrapState = (data: {
    config: Record<string, any>;
    summary: AwsSetupSummary;
  }) => {
    refreshProviderQueries();
    setConfigForm(data.config);
    setConfigEnabled(true);
    setAllowUserRegionSelection(false);
    setAwsSetupSummary({ stackName: data.summary.stackName });
  };

  const applyAwsDeleteState = (data: { config: Record<string, any> }) => {
    refreshProviderQueries();
    setConfigForm(data.config);
    setConfigEnabled(false);
    setAwsSetupSummary(null);
  };

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

  const { data: agentTypes } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
  });

  const { data: images } = useQuery({
    queryKey: ["admin", "images"],
    queryFn: () => trpcClient.admin.infrastructure.listImages.query(),
  });

  const { data: providerImageAssignments } = useQuery({
    queryKey: ["admin", "providerImageAssignments", providerId],
    queryFn: () =>
      trpcClient.admin.infrastructure.listProviderImageAssignments.query({
        cloudProviderId: providerId as string,
      }),
    enabled: !!providerId,
  });

  const updateProvider = useMutation({
    mutationFn: (params: {
      id: string;
      providerConfigId?: string | null;
      name?: string;
      supportsRegions?: boolean;
      allowUserRegionSelection?: boolean;
    }) => trpcClient.admin.infrastructure.updateProvider.mutate(params),
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

  const upsertProviderImageAssignment = useMutation({
    mutationFn: (params: { cloudProviderId: string; agentTypeId: string; imageId: string }) =>
      trpcClient.admin.infrastructure.upsertProviderImageAssignment.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "providerImageAssignments", providerId],
      });
      toast.success("Provider image assignment saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteProviderImageAssignment = useMutation({
    mutationFn: (params: { cloudProviderId: string; agentTypeId: string }) =>
      trpcClient.admin.infrastructure.deleteProviderImageAssignment.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "providerImageAssignments", providerId],
      });
      toast.success("Provider image assignment removed");
    },
    onError: (error) => toast.error(error.message),
  });

  const bootstrapAwsProvider = useMutation({
    mutationFn: (params: {
      providerId: string;
      configName?: string;
      accessKeyId: string;
      secretAccessKey: string;
      defaultRegion: string;
      publicSshEnabled?: boolean;
    }) => trpcClient.admin.aws.bootstrap.mutate(params),
    onSuccess: (data) => {
      applyAwsBootstrapState(data);
      toast.success("AWS infrastructure provisioned and saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteAwsInfrastructure = useMutation({
    mutationFn: (params: { providerId: string }) =>
      trpcClient.admin.aws.deleteInfrastructure.mutate(params),
    onSuccess: (data) => {
      applyAwsDeleteState(data);
      toast.success(
        data.deleted
          ? `AWS infrastructure deleted (${data.stackName})`
          : `AWS infrastructure was already absent (${data.stackName})`,
      );
    },
    onError: (error) => toast.error(error.message),
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
  const isAwsProvider =
    selectedProviderType?.name?.toLowerCase() === "aws" ||
    provider?.name?.trim().toLowerCase() === "aws";

  const isSavingConfig =
    createProviderConfig.isPending ||
    updateProviderConfig.isPending ||
    updateProvider.isPending ||
    toggleProviderConfig.isPending ||
    toggleProvider.isPending;
  const isBootstrappingAws = bootstrapAwsProvider.isPending;
  const isDeletingAwsInfrastructure = deleteAwsInfrastructure.isPending;

  const assignmentByAgentType = new Map(
    providerImageAssignments?.map((assignment: any) => [assignment.agentTypeId, assignment]) ?? [],
  );

  const assignableAgentTypes = agentTypes?.filter((agent: any) => agent.isEnabled) ?? [];

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
    setAllowUserRegionSelection(provider.allowUserRegionSelection ?? true);
    setConfigName(provider.providerConfig?.name ?? `${provider.name} Default`);
    setConfigForm(provider.providerConfig?.config ?? {});
    setConfigEnabled(provider.providerConfig?.isEnabled ?? true);
  }, [
    provider?.id,
    provider?.updatedAt,
    provider?.providerConfig?.id,
    provider?.providerConfig?.updatedAt,
  ]);

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

  useEffect(() => {
    if (!isAwsProvider) {
      setAwsSetupSummary(null);
    }
  }, [isAwsProvider]);

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

    if (isAwsProvider) {
      toast.error("Use the Simple Setup button to provision AWS infrastructure.");
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

      if (allowUserRegionSelection !== provider.allowUserRegionSelection) {
        await updateProvider.mutateAsync({
          id: provider.id,
          allowUserRegionSelection,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
      toast.success("Provider settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save provider settings");
    }
  };

  const AWS_EDITABLE_FIELDS = ["accessKeyId", "secretAccessKey", "defaultRegion"];

  const renderField = (field: ProviderConfigField, readOnly = false) => {
    const value = configForm[field.fieldName] ?? field.defaultValue ?? "";

    if (field.fieldType === "password") {
      return (
        <div key={field.fieldName} className={cn("space-y-2", readOnly && "opacity-60")}>
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && !readOnly && <span className="text-destructive">*</span>}
            </Label>
            {field.isEncrypted && <Lock className="h-3 w-3 text-muted-foreground" />}
          </div>
          <Input
            id={field.fieldName}
            type="password"
            placeholder={field.fieldLabel}
            value={value}
            onChange={(e) => setConfigForm({ ...configForm, [field.fieldName]: e.target.value })}
            required={field.isRequired && !readOnly}
            readOnly={readOnly}
            className={cn(readOnly && "cursor-default")}
          />
        </div>
      );
    }

    if (field.fieldType === "boolean") {
      return (
        <div key={field.fieldName} className={cn("space-y-2", readOnly && "opacity-60")}>
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && !readOnly && <span className="text-destructive">*</span>}
            </Label>
            {field.isEncrypted && <Lock className="h-3 w-3 text-muted-foreground" />}
          </div>
          <Switch
            id={field.fieldName}
            checked={value === true || value === "true"}
            disabled={readOnly}
            onCheckedChange={(checked) =>
              !readOnly && setConfigForm({ ...configForm, [field.fieldName]: checked })
            }
          />
        </div>
      );
    }

    if (field.fieldType === "select" && field.options) {
      return (
        <div key={field.fieldName} className={cn("space-y-2", readOnly && "opacity-60")}>
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && !readOnly && <span className="text-destructive">*</span>}
            </Label>
            {field.isEncrypted && <Lock className="h-3 w-3 text-muted-foreground" />}
          </div>
          {readOnly ? (
            <Input
              value={field.options.find((o) => o.value === value)?.label ?? value}
              readOnly
              className="cursor-default"
            />
          ) : (
            <Select
              value={value}
              onValueChange={(val) => setConfigForm({ ...configForm, [field.fieldName]: val })}
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
          )}
        </div>
      );
    }

    if (
      isAwsProvider &&
      field.fieldName === "defaultRegion" &&
      provider?.regions &&
      provider.regions.length > 0
    ) {
      return (
        <div key={field.fieldName} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && <span className="text-destructive">*</span>}
            </Label>
          </div>
          <Select
            value={value}
            onValueChange={(val) => setConfigForm({ ...configForm, [field.fieldName]: val })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a region" />
            </SelectTrigger>
            <SelectContent>
              {provider.regions.map((r: any) => (
                <SelectItem key={r.externalRegionIdentifier} value={r.externalRegionIdentifier}>
                  {r.name} ({r.externalRegionIdentifier})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div key={field.fieldName} className={cn("space-y-2", readOnly && "opacity-60")}>
        <div className="flex items-center gap-2">
          <Label htmlFor={field.fieldName}>
            {field.fieldLabel}
            {field.isRequired && !readOnly && <span className="text-destructive">*</span>}
          </Label>
          {field.isEncrypted && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
        <Input
          id={field.fieldName}
          type={field.fieldType === "number" ? "number" : field.fieldType}
          placeholder={field.fieldLabel}
          value={value}
          onChange={(e) => setConfigForm({ ...configForm, [field.fieldName]: e.target.value })}
          required={field.isRequired && !readOnly}
          readOnly={readOnly}
          className={cn(readOnly && "cursor-default")}
        />
      </div>
    );
  };

  const awsAccessKeyId = String(configForm.accessKeyId ?? "").trim();
  const awsSecretAccessKey = String(configForm.secretAccessKey ?? "").trim();
  const awsDefaultRegion = String(configForm.defaultRegion ?? "").trim();
  const awsPublicSshEnabled = configForm.publicSshEnabled !== false;
  const hasSavedAwsCredentials = isAwsProvider && !!provider?.providerConfig;
  const hasEnteredAwsCredentials = awsAccessKeyId.length > 0 && awsSecretAccessKey.length > 0;
  const canRunAwsSimpleSetup =
    !!provider?.id &&
    awsDefaultRegion.length > 0 &&
    (hasEnteredAwsCredentials || hasSavedAwsCredentials);

  const hasExistingAwsSetup = isAwsProvider && !!configForm.clusterArn;
  const canDeleteAwsInfrastructure =
    !!provider?.id && awsDefaultRegion.length > 0 && hasSavedAwsCredentials;
  const canResetAwsInfrastructure = hasExistingAwsSetup && canRunAwsSimpleSetup;
  const isAwsActionPending = isDeletingAwsInfrastructure || isResettingAwsInfrastructure;

  const handleAwsSimpleSetup = async () => {
    if (!provider?.id) {
      toast.error("Provider not found.");
      return;
    }

    await bootstrapAwsProvider.mutateAsync({
      providerId: provider.id,
      configName: configName.trim() || `${provider.name} Default`,
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
      defaultRegion: awsDefaultRegion,
      publicSshEnabled: awsPublicSshEnabled,
    });
  };

  const handleDeleteAwsInfrastructure = async () => {
    if (!provider?.id) {
      toast.error("Provider not found.");
      return;
    }

    setAwsActionDialog("delete");
  };

  const confirmDeleteAwsInfrastructure = async () => {
    if (!provider?.id) {
      toast.error("Provider not found.");
      return;
    }

    try {
      await deleteAwsInfrastructure.mutateAsync({ providerId: provider.id });
      setAwsActionDialog(null);
    } catch {
      return;
    }
  };

  const handleResetAwsInfrastructure = async () => {
    if (!provider?.id) {
      toast.error("Provider not found.");
      return;
    }

    setIsResettingAwsInfrastructure(true);
    try {
      await trpcClient.admin.aws.deleteInfrastructure.mutate({ providerId: provider.id });
      const bootstrapResult = await trpcClient.admin.aws.bootstrap.mutate({
        providerId: provider.id,
        configName: configName.trim() || `${provider.name} Default`,
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
        defaultRegion: awsDefaultRegion,
        publicSshEnabled: awsPublicSshEnabled,
      });

      applyAwsBootstrapState(bootstrapResult);
      toast.success(`AWS infrastructure reset (${bootstrapResult.summary.stackName})`);
      setAwsActionDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset AWS infrastructure");
    } finally {
      setIsResettingAwsInfrastructure(false);
    }
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
                  <p className="text-sm font-medium text-foreground/90">Provider</p>
                  <p className="text-xs text-muted-foreground">
                    Update the display name and enablement for this provider.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">Enabled</Label>
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
              {provider?.supportsRegions && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-foreground/[0.08] bg-foreground/[0.01] p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground/90">
                      Allow User Region Selection
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isAwsProvider
                        ? "AWS uses the default region selected in the credentials config above."
                        : "When enabled, users can choose a region. When disabled, the default region is always used."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm text-muted-foreground">Enabled</Label>
                    <Switch
                      checked={isAwsProvider ? false : allowUserRegionSelection}
                      disabled={isAwsProvider}
                      onCheckedChange={setAllowUserRegionSelection}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Credentials & Config Section */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground/90">Credentials & Config</p>
                  <p
                    className={cn(
                      "text-xs",
                      provider?.providerConfig
                        ? provider.providerConfig.isEnabled
                          ? "text-emerald-400"
                          : "text-muted-foreground"
                        : "text-amber-400",
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

              {isAwsProvider && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-foreground/[0.015] px-4 py-3">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
                    <span className="text-muted-foreground">aws.stack</span>
                    <span className="h-1 w-1 rounded-full bg-foreground/20" />
                    <span
                      className={
                        hasExistingAwsSetup ? "text-emerald-300/80" : "text-muted-foreground"
                      }
                    >
                      {hasExistingAwsSetup
                        ? (awsSetupSummary?.stackName ?? "active")
                        : "not provisioned"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAwsSimpleSetup}
                      disabled={!canRunAwsSimpleSetup || isBootstrappingAws || isAwsActionPending}
                    >
                      {isBootstrappingAws ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {hasExistingAwsSetup ? "Apply" : "Provision"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAwsActionDialog("reset")}
                      disabled={
                        !canResetAwsInfrastructure || isBootstrappingAws || isAwsActionPending
                      }
                    >
                      {isResettingAwsInfrastructure ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RefreshCw />
                      )}
                      Reset
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={handleDeleteAwsInfrastructure}
                      disabled={
                        !canDeleteAwsInfrastructure || isBootstrappingAws || isAwsActionPending
                      }
                    >
                      {isDeletingAwsInfrastructure ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}
                      Delete
                    </Button>
                  </div>
                </div>
              )}

              <Dialog
                open={awsActionDialog !== null}
                onOpenChange={(open) => !open && setAwsActionDialog(null)}
              >
                <DialogContent className="sm:max-w-xl">
                  <DialogHeader>
                    <div className="pb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      <span>{awsActionDialog === "reset" ? "aws.reset" : "aws.delete"}</span>
                    </div>
                    <DialogTitle>
                      {awsActionDialog === "reset"
                        ? "Reset AWS infrastructure"
                        : "Delete AWS infrastructure"}
                    </DialogTitle>
                    <DialogDescription>
                      {awsActionDialog === "reset"
                        ? "GitTerm will delete the shared stack, then provision it again using the saved region and encrypted credentials."
                        : "The shared AWS stack will be removed. Saved credentials and region stay encrypted in GitTerm for a future rebuild."}
                    </DialogDescription>
                  </DialogHeader>

                  <ul className="overflow-hidden rounded-lg border border-border divide-y divide-border/70">
                    {[
                      "All AWS workspaces for this provider must already be deleted.",
                      awsActionDialog === "reset"
                        ? "Saved access keys remain encrypted and will be reused for the rebuild."
                        : "Saved access keys remain encrypted and are not removed.",
                      awsActionDialog === "reset"
                        ? "Provider returns to service as soon as the new stack finishes provisioning."
                        : "Provider stays inactive until you provision or repair infrastructure again.",
                    ].map((line, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-3 px-4 py-2.5 text-xs leading-relaxed text-foreground/60"
                      >
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAwsActionDialog(null)}
                      disabled={isAwsActionPending || isBootstrappingAws}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={awsActionDialog === "reset" ? "secondary" : "destructive"}
                      onClick={
                        awsActionDialog === "reset"
                          ? handleResetAwsInfrastructure
                          : confirmDeleteAwsInfrastructure
                      }
                      disabled={isAwsActionPending || isBootstrappingAws}
                    >
                      {awsActionDialog === "reset" ? (
                        isResettingAwsInfrastructure ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Resetting
                          </>
                        ) : (
                          <>
                            <RefreshCw />
                            Confirm Reset
                          </>
                        )
                      ) : isDeletingAwsInfrastructure ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Deleting
                        </>
                      ) : (
                        <>
                          <Trash2 />
                          Confirm Delete
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {!selectedProviderTypeId && (
                <div className="mt-4 rounded-xl border border-dashed border-foreground/[0.08] bg-foreground/[0.01] p-4 text-sm text-muted-foreground">
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
                    .map((field) =>
                      renderField(
                        field,
                        isAwsProvider && !AWS_EDITABLE_FIELDS.includes(field.fieldName),
                      ),
                    )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground/90">Default Images</p>
                  <p className="text-xs text-muted-foreground">
                    Choose the container image this provider should use for each agent type.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-xs"
                >
                  {providerImageAssignments?.length ?? 0} assigned
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                {assignableAgentTypes.map((agent: any) => {
                  const assignment = assignmentByAgentType.get(agent.id) as any;
                  const compatibleImages =
                    images?.filter((img: any) => img.agentTypeId === agent.id && img.isEnabled) ??
                    [];
                  const selectedImageId = assignment?.imageId ?? "fallback";

                  return (
                    <div
                      key={agent.id}
                      className="grid gap-3 rounded-xl border border-border/70 bg-foreground/[0.01] p-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-center"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground/90">{agent.name}</p>
                          {agent.serverOnly && (
                            <Badge
                              variant="outline"
                              className="border-foreground/[0.08] text-[10px]"
                            >
                              Server Only
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {assignment?.image?.imageId ??
                            "Uses the global default image for this agent type."}
                        </p>
                      </div>

                      <Select
                        value={selectedImageId}
                        disabled={!provider?.id || compatibleImages.length === 0}
                        onValueChange={(imageId) => {
                          if (!provider?.id) {
                            return;
                          }

                          if (imageId === "fallback") {
                            deleteProviderImageAssignment.mutate({
                              cloudProviderId: provider.id,
                              agentTypeId: agent.id,
                            });
                            return;
                          }

                          upsertProviderImageAssignment.mutate({
                            cloudProviderId: provider.id,
                            agentTypeId: agent.id,
                            imageId,
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select image" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fallback">Global default</SelectItem>
                          {compatibleImages.map((img: any) => (
                            <SelectItem key={img.id} value={img.id}>
                              {img.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                {assignableAgentTypes.length === 0 && (
                  <div className="rounded-xl border border-dashed border-foreground/[0.08] bg-foreground/[0.01] p-4 text-sm text-muted-foreground">
                    No enabled agent types are available.
                  </div>
                )}
              </div>
            </div>

            {provider?.supportsRegions && (
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground/90">Regions</p>
                    <p className="text-xs text-muted-foreground">
                      Enable, disable, or add regions for this provider.
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-xs"
                  >
                    {provider?.regions?.length ?? 0} total
                  </Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {provider?.regions?.length ? (
                    provider.regions.map((region: any) => (
                      <div
                        key={region.id}
                        className={`flex items-center justify-between rounded-xl border border-border bg-foreground/[0.02] px-4 py-3 ${
                          !region.isEnabled ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-foreground/[0.04] p-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground/90">
                                {region.name}
                              </span>
                              {!region.isEnabled && (
                                <Badge
                                  variant="outline"
                                  className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-xs"
                                >
                                  Disabled
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
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
                    <p className="py-12 text-center text-muted-foreground">
                      No regions configured yet.
                    </p>
                  )}
                </div>

                <div className="mt-5 rounded-xl border border-dashed border-foreground/[0.08] bg-foreground/[0.01] p-5">
                  <p className="text-sm font-medium text-foreground/90">Add Region</p>
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
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

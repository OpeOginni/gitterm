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
import { Textarea } from "@/components/ui/textarea";
import {
  Cpu,
  Download,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
  Wand2,
} from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { getIcon } from "@/components/dashboard/create-instance/types";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { strToU8, zipSync } from "fflate";

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

type MachineField = {
  path: string;
  label: string;
  type?: "number" | "text" | "select";
  placeholder?: string;
  options?: string[];
};

const MACHINE_FIELDS: Record<string, MachineField[]> = {
  aws: [
    { path: "cpu", label: "CPU units", type: "number", placeholder: "4096" },
    { path: "memory", label: "Memory (MiB)", type: "number", placeholder: "16384" },
    { path: "ephemeralStorageGiB", label: "Disk (GiB)", type: "number", placeholder: "20" },
    { path: "architecture", label: "Architecture", type: "select", options: ["X86_64", "ARM64"] },
  ],
  e2b: [
    { path: "templateId", label: "Template ID", placeholder: "gitterm-opencode" },
    { path: "sshTemplateId", label: "SSH template ID", placeholder: "Optional" },
  ],
  daytona: [
    { path: "resources.cpu", label: "CPU", type: "number", placeholder: "2" },
    { path: "resources.memory", label: "Memory (GB)", type: "number", placeholder: "4" },
    { path: "resources.disk", label: "Disk (GB)", type: "number", placeholder: "20" },
  ],
  vercel: [{ path: "vcpus", label: "vCPUs", type: "number", placeholder: "2" }],
  ascii: [
    { path: "size", label: "Box size", type: "select", options: ["small", "default", "large"] },
  ],
  exedev: [
    { path: "cpu", label: "CPUs", type: "number", placeholder: "2" },
    { path: "memory", label: "Memory", placeholder: "8GB" },
    { path: "disk", label: "Disk", placeholder: "25GB" },
  ],
};

function setNestedOption(options: Record<string, any>, path: string, value: string) {
  const [parent, child] = path.split(".");
  const parsedValue =
    value === "" ? undefined : Number.isFinite(Number(value)) ? Number(value) : value;
  if (!child) return { ...options, [parent]: parsedValue };
  return { ...options, [parent]: { ...options[parent], [child]: parsedValue } };
}

function getMachineProfileKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
  const [newMachineProfile, setNewMachineProfile] = useState({
    name: "",
    providerOptions: {} as Record<string, any>,
    isDefault: false,
  });
  const [setupAgentTypeId, setSetupAgentTypeId] = useState("all");
  const [setupScript, setSetupScript] = useState("");

  const refreshProviderQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
    queryClient.invalidateQueries({
      queryKey: ["admin", "provider", providerId],
    });
  };

  const preserveAwsEncryptedFields = (
    nextConfig: Record<string, any>,
    currentConfig: Record<string, any>,
  ) => {
    if ((provider as { providerKey?: string } | undefined)?.providerKey !== "aws") {
      return nextConfig;
    }

    const merged = { ...nextConfig };
    for (const fieldName of ["accessKeyId", "secretAccessKey"]) {
      const nextValue = String(nextConfig[fieldName] ?? "").trim();
      const currentValue = String(currentConfig[fieldName] ?? "").trim();
      if (!nextValue && currentValue) {
        merged[fieldName] = currentConfig[fieldName];
      }
    }

    return merged;
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

  const { data: provider, isLoading: isLoadingProvider } = useQuery({
    queryKey: ["admin", "provider", providerId],
    queryFn: () =>
      trpcClient.admin.infrastructure.getProvider.query({
        id: providerId as string,
      }),
    enabled: !!providerId,
  });

  const { data: providerTypes } = useQuery({
    queryKey: ["admin", "providerTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listProviderTypes.query(),
  });

  const { data: agentTypes } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
  });

  const { data: setupDefaults } = useQuery({
    queryKey: ["admin", "workspaceSetupDefaults", providerId],
    queryFn: () =>
      trpcClient.admin.infrastructure.listWorkspaceSetupDefaults.query({
        cloudProviderId: providerId as string,
      }),
    enabled: !!providerId,
  });

  const { data: machineProfiles } = useQuery({
    queryKey: ["admin", "machineProfiles", providerId],
    queryFn: () =>
      trpcClient.admin.infrastructure.listMachineProfiles.query({
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
      trpcClient.admin.infrastructure.toggleProviderConfig.mutate({
        id,
        isEnabled,
      }),
  });

  const setSetupDefault = useMutation({
    mutationFn: (params: {
      cloudProviderId: string;
      agentTypeId: string | null;
      commands: string[];
    }) => trpcClient.admin.infrastructure.setWorkspaceSetupDefault.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "workspaceSetupDefaults", providerId],
      });
      toast.success("Default setup script saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const createMachineProfile = useMutation({
    mutationFn: (params: {
      cloudProviderId: string;
      name: string;
      providerOptions: Record<string, unknown>;
      isDefault: boolean;
    }) => trpcClient.admin.infrastructure.createMachineProfile.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "machineProfiles", providerId] });
      setNewMachineProfile({ name: "", providerOptions: {}, isDefault: false });
      toast.success("Machine profile created");
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMachineProfile = useMutation({
    mutationFn: (params: { id: string; isDefault?: boolean; isEnabled?: boolean }) =>
      trpcClient.admin.infrastructure.updateMachineProfile.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "machineProfiles", providerId] });
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMachineProfile = useMutation({
    mutationFn: (id: string) => trpcClient.admin.infrastructure.deleteMachineProfile.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "machineProfiles", providerId] });
      toast.success("Machine profile deleted");
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
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.cancelQueries({
        queryKey: ["admin", "provider", providerId],
      });
      queryClient.removeQueries({
        queryKey: ["admin", "provider", providerId],
      });
      toast.success(
        data.deleted
          ? `AWS infrastructure and provider deleted (${data.stackName})`
          : `AWS provider deleted (${data.stackName})`,
      );
      router.push("/admin/providers" as Route);
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
      queryClient.invalidateQueries({
        queryKey: ["admin", "provider", providerId],
      });
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
      queryClient.invalidateQueries({
        queryKey: ["admin", "provider", providerId],
      });
      toast.success(`Region ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const findProviderTypeId = (providerNameValue: string) =>
    providerTypes?.find(
      (type) => type.name.toLowerCase() === providerNameValue.trim().toLowerCase(),
    )?.id ?? "";

  // Find a provider type by key (the canonical implementation identifier on
  // the cloud_provider row, e.g. "aws" for any AWS region-scoped provider).
  // Display names like "AWS EU (Frankfurt)" don't match a registered provider
  // type by name, so for region-scoped providers we must resolve via providerKey.
  const findProviderTypeIdByKey = (providerKeyValue: string | undefined | null) => {
    if (!providerKeyValue) return "";
    return (
      providerTypes?.find(
        (type) => type.name.toLowerCase() === providerKeyValue.trim().toLowerCase(),
      )?.id ?? ""
    );
  };

  const providerKey = (provider as { providerKey?: string } | undefined)?.providerKey ?? "";

  const resolvedProviderTypeId =
    selectedProviderTypeId ||
    provider?.providerConfig?.providerTypeId ||
    findProviderTypeIdByKey(providerKey) ||
    findProviderTypeId(provider?.name ?? "");

  const selectedProviderType = providerTypes?.find((type) => type.id === resolvedProviderTypeId);
  // Resolve AWS-ness from providerKey (data source of truth) rather than the
  // display name, which is user-defined per region (e.g. "AWS EU (Frankfurt)").
  const isAwsProvider =
    providerKey.toLowerCase() === "aws" || selectedProviderType?.name?.toLowerCase() === "aws";

  const isCloudflareProvider =
    providerKey.toLowerCase() === "cloudflare" ||
    selectedProviderType?.name?.toLowerCase() === "cloudflare";

  const { data: cloudflareManualSetup } = useQuery({
    queryKey: ["admin", "cloudflareManualSetup"],
    queryFn: () => trpcClient.admin.cloudflare.manualSetup.query(),
    enabled: isCloudflareProvider,
  });

  const { data: cloudflareWorkerFiles } = useQuery({
    queryKey: ["admin", "cloudflareWorkerFiles"],
    queryFn: () => trpcClient.admin.cloudflare.workerFiles.query(),
    enabled: isCloudflareProvider,
  });

  const downloadWorkerZip = () => {
    const files = cloudflareWorkerFiles ?? [];
    if (files.length === 0) return;

    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
      // Preserve folder structure (e.g. src/index.ts) so `wrangler deploy`
      // resolves `main` correctly from the unzipped folder.
      entries[file.path] = strToU8(file.contents);
    }

    const zipped = zipSync(entries, { level: 6 });
    const blob = new Blob([zipped], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gitterm-cloudflare-sandbox.zip";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const { data: selectedProviderFields, isLoading: isLoadingFields } = useQuery({
    queryKey: ["admin", "providerConfigFields", resolvedProviderTypeId],
    queryFn: () =>
      trpcClient.admin.infrastructure.getProviderConfigFields.query({
        providerTypeId: resolvedProviderTypeId,
      }),
    enabled: !!resolvedProviderTypeId,
  });

  const isSavingConfig =
    createProviderConfig.isPending ||
    updateProviderConfig.isPending ||
    updateProvider.isPending ||
    toggleProviderConfig.isPending ||
    toggleProvider.isPending;
  const isBootstrappingAws = bootstrapAwsProvider.isPending;
  const isDeletingAwsInfrastructure = deleteAwsInfrastructure.isPending;

  const machineFields = MACHINE_FIELDS[provider?.providerKey ?? ""] ?? [];

  useEffect(() => {
    const selectedAgentTypeId = setupAgentTypeId === "all" ? null : setupAgentTypeId;
    const selectedDefault = setupDefaults?.find(
      (entry) => entry.agentTypeId === selectedAgentTypeId,
    );
    setSetupScript(selectedDefault?.commands.join("\n") ?? "");
  }, [setupAgentTypeId, setupDefaults]);

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

    const pinnedAwsRegion =
      provider.providerKey === "aws"
        ? (provider.regions?.find((region: any) => region.isEnabled) ?? provider.regions?.[0])
        : undefined;

    setProviderName(provider.name ?? "");
    setAllowUserRegionSelection(provider.allowUserRegionSelection ?? true);
    setConfigName(provider.providerConfig?.name ?? `${provider.name} Default`);
    setConfigForm((current) =>
      preserveAwsEncryptedFields(
        {
          ...provider.providerConfig?.config,
          ...(pinnedAwsRegion
            ? {
                defaultRegion: pinnedAwsRegion.externalRegionIdentifier,
              }
            : {}),
        },
        current,
      ),
    );
    setConfigEnabled(provider.providerConfig?.isEnabled ?? true);
  }, [
    provider?.id,
    provider?.updatedAt,
    provider?.providerConfig?.id,
    provider?.providerConfig?.updatedAt,
    provider?.regions,
    provider?.name,
    provider?.providerConfig?.name,
    provider?.providerConfig?.config,
    provider?.providerKey,
    provider,
    provider?.providerConfig?.isEnabled,
    provider?.allowUserRegionSelection,
  ]);

  useEffect(() => {
    if (!provider || selectedProviderTypeId) {
      return;
    }

    // Resolution order:
    //  1. The providerConfig's explicit providerTypeId (most reliable - set at bootstrap).
    //  2. The cloud_provider's providerKey (e.g. "aws") - maps any region-scoped
    //     AWS row like "AWS EU (Frankfurt)" to the registered AWS provider type.
    //  3. Display-name match (covers legacy providers whose name equals the type
    //     name like "Railway", "Cloudflare", etc.).
    const providerTypeId =
      provider.providerConfig?.providerTypeId ??
      findProviderTypeIdByKey((provider as any).providerKey) ??
      findProviderTypeId(provider.name);

    if (providerTypeId) {
      setSelectedProviderTypeId(providerTypeId);
    }
  }, [provider, providerTypes, selectedProviderTypeId, findProviderTypeIdByKey]);

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
      await toggleProvider.mutateAsync({
        id: provider.id,
        isEnabled: newEnabledState,
      });
      toast.success(`Provider ${newEnabledState ? "enabled" : "disabled"}`);
      queryClient.invalidateQueries({
        queryKey: ["admin", "provider", providerId],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle provider");
      console.error("Failed to toggle provider", error);
    }
  };

  const handleSaveSettings = async () => {
    if (!provider || !resolvedProviderTypeId) {
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
          providerTypeId: resolvedProviderTypeId,
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
        await toggleProviderConfig.mutateAsync({
          id: configId,
          isEnabled: configEnabled,
        });
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
      queryClient.invalidateQueries({
        queryKey: ["admin", "provider", providerId],
      });
      toast.success("Provider settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save provider settings");
    }
  };

  const AWS_EDITABLE_FIELDS = [
    "accessKeyId",
    "secretAccessKey",
    "defaultRegion",
    "publicSshEnabled",
  ];

  const renderField = (field: ProviderConfigField, readOnly = false) => {
    const value = configForm[field.fieldName] ?? field.defaultValue ?? "";
    const encryptedFieldPreview = provider?.providerConfig?.configPreviews?.[field.fieldName] ?? "";
    const hasSavedEncryptedValue =
      !!provider?.providerConfig &&
      field.isEncrypted &&
      String(encryptedFieldPreview).trim().length > 0 &&
      String(value ?? "").trim().length === 0 &&
      !readOnly;

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
          {hasSavedEncryptedValue && (
            <div className="rounded-md border border-border/70 bg-foreground/[0.02] px-3 py-2 font-mono text-xs text-muted-foreground">
              {encryptedFieldPreview}
            </div>
          )}
          <Input
            id={field.fieldName}
            type="password"
            placeholder={hasSavedEncryptedValue ? "Enter new value to replace" : field.fieldLabel}
            value={value}
            onChange={(e) =>
              setConfigForm({
                ...configForm,
                [field.fieldName]: e.target.value,
              })
            }
            required={field.isRequired && !readOnly}
            readOnly={readOnly}
            className={cn(readOnly && "cursor-default")}
          />
          {hasSavedEncryptedValue && (
            <p className="text-xs text-muted-foreground">
              Current value is masked above. Leave this blank to keep it, or enter a new one to
              replace it.
            </p>
          )}
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
      const pinnedRegion =
        provider.regions.find((region: any) => region.isEnabled) ?? provider.regions[0];

      return (
        <div key={field.fieldName} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={field.fieldName}>
              {field.fieldLabel}
              {field.isRequired && <span className="text-destructive">*</span>}
            </Label>
          </div>
          <Input
            id={field.fieldName}
            value={pinnedRegion?.externalRegionIdentifier ?? value}
            readOnly
            className="cursor-default"
          />
          {pinnedRegion && (
            <p className="text-xs text-muted-foreground">
              Pinned to {pinnedRegion.name} for this AWS provider.
            </p>
          )}
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
        {hasSavedEncryptedValue && (
          <div className="rounded-md border border-border/70 bg-foreground/[0.02] px-3 py-2 font-mono text-xs text-muted-foreground">
            {encryptedFieldPreview}
          </div>
        )}
        <Input
          id={field.fieldName}
          type={field.fieldType === "number" ? "number" : field.fieldType}
          placeholder={hasSavedEncryptedValue ? "Enter new value to replace" : field.fieldLabel}
          value={value}
          onChange={(e) => setConfigForm({ ...configForm, [field.fieldName]: e.target.value })}
          required={field.isRequired && !readOnly}
          readOnly={readOnly}
          className={cn(readOnly && "cursor-default")}
        />
        {hasSavedEncryptedValue && (
          <p className="text-xs text-muted-foreground">
            Current value is masked above. Leave this blank to keep it, or enter a new one to
            replace it.
          </p>
        )}
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
  const newMachineProfileKey = getMachineProfileKey(newMachineProfile.name);
  const duplicateMachineProfile = machineProfiles?.find(
    (profile) => getMachineProfileKey(profile.name) === newMachineProfileKey,
  );

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
      toast("Deleting AWS infrastructure. This can take a few minutes.");
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
      await trpcClient.admin.aws.deleteInfrastructure.mutate({
        providerId: provider.id,
      });
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
        icon={
          provider ? (
            <div className="rounded-xl border border-border bg-foreground/[0.02] p-2">
              <img src={getIcon(provider.providerKey)} alt="" className="h-5 w-5 object-contain" />
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin/providers" as Route}>Back to Providers</Link>
          </Button>
          <Button
            onClick={handleSaveSettings}
            disabled={!resolvedProviderTypeId || isSavingConfig}
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
          <div className="flex flex-col gap-6">
            {/* Machine Profiles Section */}
            <div className="order-1 rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground/90">Machine Profiles</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Name provider-specific compute settings once, then expose the stable key to the
                    SDK.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-foreground/[0.08] bg-foreground/[0.04] text-xs text-muted-foreground"
                >
                  {machineProfiles?.length ?? 0} profiles
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                {machineProfiles?.map((profile) => (
                  <div
                    key={profile.id}
                    className="grid gap-3 rounded-xl border border-border/70 bg-foreground/[0.01] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground/90">{profile.name}</p>
                        <code className="rounded bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {profile.key}
                        </code>
                        {profile.isDefault && <Badge variant="secondary">Default</Badge>}
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {Object.keys(profile.providerOptions).length > 0
                          ? JSON.stringify(profile.providerOptions)
                          : "Provider-managed resources"}
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {!profile.isDefault && profile.isEnabled && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateMachineProfile.mutate({ id: profile.id, isDefault: true })
                          }
                        >
                          Make default
                        </Button>
                      )}
                      <Switch
                        checked={profile.isEnabled}
                        onCheckedChange={(isEnabled) =>
                          updateMachineProfile.mutate({ id: profile.id, isEnabled })
                        }
                        aria-label={`${profile.isEnabled ? "Disable" : "Enable"} ${profile.name}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMachineProfile.mutate(profile.id)}
                        aria-label={`Delete ${profile.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}

                {machineFields.length > 0 ? (
                  <div className="rounded-xl border border-dashed border-foreground/[0.12] p-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="machine-name">Profile name</Label>
                        <Input
                          id="machine-name"
                          value={newMachineProfile.name}
                          placeholder="Standard"
                          onChange={(event) =>
                            setNewMachineProfile((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                        {newMachineProfileKey && (
                          <p className="text-xs text-muted-foreground">
                            SDK key: <code>{newMachineProfileKey}</code>
                          </p>
                        )}
                        {duplicateMachineProfile && (
                          <p className="text-xs text-destructive">
                            A profile named {duplicateMachineProfile.name} already exists.
                          </p>
                        )}
                      </div>
                      {machineFields.map((field) => {
                        const [parent, child] = field.path.split(".");
                        const value = child
                          ? newMachineProfile.providerOptions[parent]?.[child]
                          : newMachineProfile.providerOptions[parent];
                        return (
                          <div key={field.path} className="space-y-2">
                            <Label>{field.label}</Label>
                            {field.type === "select" ? (
                              <Select
                                value={String(value ?? "")}
                                onValueChange={(nextValue) =>
                                  setNewMachineProfile((current) => ({
                                    ...current,
                                    providerOptions: setNestedOption(
                                      current.providerOptions,
                                      field.path,
                                      nextValue,
                                    ),
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={`Select ${field.label.toLowerCase()}`}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {field.options?.map((option) => (
                                    <SelectItem key={option} value={option}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                type={field.type ?? "text"}
                                value={String(value ?? "")}
                                placeholder={field.placeholder}
                                onChange={(event) =>
                                  setNewMachineProfile((current) => ({
                                    ...current,
                                    providerOptions: setNestedOption(
                                      current.providerOptions,
                                      field.path,
                                      event.target.value,
                                    ),
                                  }))
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={newMachineProfile.isDefault}
                          onCheckedChange={(isDefault) =>
                            setNewMachineProfile((current) => ({ ...current, isDefault }))
                          }
                        />
                        Use by default
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          !provider?.id ||
                          !newMachineProfile.name ||
                          !newMachineProfileKey ||
                          !!duplicateMachineProfile ||
                          createMachineProfile.isPending
                        }
                        onClick={() =>
                          provider?.id &&
                          createMachineProfile.mutate({
                            cloudProviderId: provider.id,
                            ...newMachineProfile,
                          })
                        }
                      >
                        {createMachineProfile.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Plus />
                        )}
                        Add profile
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-foreground/[0.08] p-4 text-sm text-muted-foreground">
                    {provider?.name} controls machine resources at the provider level, so no
                    per-workspace profile is required.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-end gap-2 px-1">
                <Label className="text-sm text-muted-foreground">Enabled</Label>
                <Switch
                  checked={provider?.isEnabled}
                  disabled={!provider?.isEnabled && !provider?.providerConfig?.isEnabled}
                  onCheckedChange={handleToggleProvider}
                  aria-label="Enable provider"
                />
              </div>
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                    <Input
                      value={selectedProviderType?.displayName ?? "Unknown"}
                      disabled
                      readOnly
                    />
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
            </div>

            {/* Credentials & Config Section */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground/90">Credentials & Config</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      provider?.providerConfig
                        ? provider.providerConfig.isEnabled
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                          : "border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-400",
                    )}
                  >
                    {provider?.providerConfig
                      ? provider.providerConfig.isEnabled
                        ? "Active and ready"
                        : "Saved but disabled"
                      : "Missing configurations"}
                  </Badge>
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

              {!resolvedProviderTypeId && (
                <div className="mt-4 rounded-xl border border-dashed border-foreground/[0.08] bg-foreground/[0.01] p-4 text-sm text-muted-foreground">
                  No provider definition found for this entry. Make sure the provider key maps to a
                  registered provider type.
                </div>
              )}

              {isCloudflareProvider && (
                <div className="mt-4 space-y-3 rounded-xl border border-[#f6821f]/25 bg-gradient-to-b from-[#f6821f]/[0.06] to-transparent p-4">
                  <div className="flex items-center gap-2">
                    <img src="/cloudflare.svg" alt="Cloudflare" className="h-4 w-auto" />
                    <p className="text-sm font-medium text-foreground/90">
                      Deploy the sandbox worker
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Cloudflare workspaces run behind a Worker you deploy into your own Cloudflare
                    account. Follow the steps below, then paste the resulting Worker URL and the
                    same Internal API Key into the fields below.
                  </p>

                  <ol className="space-y-2">
                    {(cloudflareManualSetup?.steps ?? []).map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-xs text-muted-foreground">
                        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#f6821f]/15 text-[10px] font-semibold text-[#f6821f]">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>

                  {cloudflareManualSetup?.command && (
                    <div className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f6821f]/80">
                        deploy command
                      </p>
                      <pre className="overflow-x-auto rounded-lg border border-[#f6821f]/20 bg-[#f6821f]/[0.04] px-3 py-2 text-[11px] leading-relaxed text-foreground/85">
                        <code>{cloudflareManualSetup.command}</code>
                      </pre>
                    </div>
                  )}

                  <div className="pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={downloadWorkerZip}
                      disabled={(cloudflareWorkerFiles?.length ?? 0) === 0}
                      className="border-[#f6821f]/30 text-[#f6821f] hover:bg-[#f6821f]/10 hover:text-[#f6821f]"
                    >
                      <Download />
                      Download setup ZIP
                    </Button>
                  </div>
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

              {resolvedProviderTypeId && isLoadingFields && (
                <div className="mt-4 space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}

              {resolvedProviderTypeId && selectedProviderFields && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {selectedProviderFields
                    .toSorted((a, b) => a.sortOrder - b.sortOrder)
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
                  <div className="flex items-center gap-2">
                    <ScrollText className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground/90">Default Setup Script</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Runs in the repository after the agent starts. Failures never stop workspace
                    readiness.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-xs"
                >
                  {setupDefaults?.filter((entry) => entry.commands.length > 0).length ?? 0}{" "}
                  configured
                </Badge>
              </div>

              <div className="mt-4 space-y-4">
                <div className="max-w-sm space-y-2">
                  <Label>Applies to</Label>
                  <Select value={setupAgentTypeId} onValueChange={setSetupAgentTypeId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All agents on this provider</SelectItem>
                      {agentTypes
                        ?.filter((agent) => agent.isEnabled)
                        .map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-setup-script">Shell script</Label>
                  <Textarea
                    id="workspace-setup-script"
                    value={setupScript}
                    onChange={(event) => setSetupScript(event.target.value)}
                    placeholder={"npm install\n./scripts/bootstrap.sh"}
                    className="min-h-36 font-mono text-xs"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Admin defaults run before commands supplied through the SDK. Logs and status are
                    written to <code>~/.gitterm/setup</code>.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!provider?.id || setSetupDefault.isPending}
                    onClick={() =>
                      provider?.id &&
                      setSetupDefault.mutate({
                        cloudProviderId: provider.id,
                        agentTypeId: setupAgentTypeId === "all" ? null : setupAgentTypeId,
                        commands: setupScript.trim() ? [setupScript.trim()] : [],
                      })
                    }
                  >
                    {setSetupDefault.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ScrollText />
                    )}
                    Save setup script
                  </Button>
                </div>
              </div>
            </div>

            {provider?.supportsRegions && !isAwsProvider && (
              <div className="order-2 rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <MapPin className="size-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground/90">Regions</p>
                    </div>
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
                            toggleRegion.mutate({
                              id: region.id,
                              isEnabled: checked,
                            })
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
                        onChange={(e) =>
                          setNewRegion({
                            ...newRegion,
                            location: e.target.value,
                          })
                        }
                        placeholder="e.g., California"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="external-id">External Identifier</Label>
                      <Input
                        id="external-id"
                        value={newRegion.externalRegionIdentifier}
                        onChange={(e) =>
                          setNewRegion({
                            ...newRegion,
                            externalRegionIdentifier: e.target.value,
                          })
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

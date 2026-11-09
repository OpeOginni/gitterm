"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Seg } from "@/components/site/seg";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft,
  Download,
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
import Image from "next/image";
import { cn } from "@/lib/utils";
import { strToU8, zipSync } from "fflate";
import { awsRoleSelectionSchema, awsAccessProfileSchema } from "@gitterm/schema";
import { AwsSetupGuide } from "../_components/aws-setup-guide";
import { ProviderWebhookGuide } from "../_components/provider-webhook-guide";
import { formatMachineSize } from "@/components/dashboard/create-instance/types";
import {
  AwsAccessProfiles,
  AwsRoleInput,
  AwsRoleCheckResult,
  type AwsRoleSelection,
} from "../_components/aws-access-profiles";
import { Panel, PanelRow, SectionHeading, StatusDot } from "@/components/dashboard/kit";
import { CopyField } from "@/components/dashboard/copy-field";
import { formPanel, providerStatus, useAdminGuard } from "../../_components/admin";

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
    { path: "templateSuffix", label: "Template size suffix", placeholder: "-lg" },
  ],
  daytona: [
    { path: "resources.cpu", label: "CPU", type: "number", placeholder: "2" },
    { path: "resources.memory", label: "Memory (GB)", type: "number", placeholder: "4" },
    { path: "resources.disk", label: "Disk (GB)", type: "number", placeholder: "20" },
  ],
  vercel: [{ path: "vcpus", label: "vCPUs", type: "number", placeholder: "2" }],
  boat: [
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

function mergePreservedEncryptedFields(
  providerKey: string | undefined,
  nextConfig: Record<string, any>,
  currentConfig: Record<string, any>,
) {
  if (providerKey !== "aws") return nextConfig;

  const merged = { ...nextConfig };
  for (const fieldName of ["accessKeyId", "secretAccessKey"]) {
    const nextValue = String(nextConfig[fieldName] ?? "").trim();
    const currentValue = String(currentConfig[fieldName] ?? "").trim();
    if (!nextValue && currentValue) {
      merged[fieldName] = currentConfig[fieldName];
    }
  }

  return merged;
}

const MACHINE_SELECTION_MODES = [
  { value: "standard", label: "Default size only" },
  { value: "profiles", label: "Users pick a size" },
] as const;

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

  const { ready } = useAdminGuard();
  const queryClient = useQueryClient();

  const [providerName, setProviderName] = useState("");
  const [allowUserRegionSelection, setAllowUserRegionSelection] = useState(true);
  const [selectedProviderTypeId, setSelectedProviderTypeId] = useState("");
  const [configForm, setConfigForm] = useState<Record<string, any>>({});
  const [configName, setConfigName] = useState("");
  const [configEnabled, setConfigEnabled] = useState(true);
  // Unsaved credential edits must survive region toggles. Those mutations refetch
  // the provider, but they do not change the saved config.
  const settingsDirtyRef = useRef(false);
  const hydratedProviderIdRef = useRef<string | null>(null);
  const appliedSettingsKeyRef = useRef("");
  const markSettingsDirty = () => {
    settingsDirtyRef.current = true;
  };
  const [awsSetupSummary, setAwsSetupSummary] = useState<AwsSetupSummary | null>(null);
  const [awsRoleOverride, setAwsRoleOverride] = useState<AwsRoleSelection | null>(null);
  const [awsRoleCheck, setAwsRoleCheck] = useState<Awaited<
    ReturnType<typeof trpcClient.admin.aws.checkAccessRole.mutate>
  > | null>(null);
  const [awsActionDialog, setAwsActionDialog] = useState<"delete" | "reset" | null>(null);
  const [isResettingAwsInfrastructure, setIsResettingAwsInfrastructure] = useState(false);
  const [newRegion, setNewRegion] = useState({
    name: "",
    location: "",
    externalRegionIdentifier: "",
  });
  const emptyMachineProfile = {
    name: "",
    vcpus: "",
    memoryGb: "",
    providerOptions: {} as Record<string, any>,
    isDefault: false,
  };
  const [newMachineProfile, setNewMachineProfile] = useState(emptyMachineProfile);
  const [setupAgentTypeId, setSetupAgentTypeId] = useState("all");
  const [setupScript, setSetupScript] = useState("");

  const refreshProviderQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
    queryClient.invalidateQueries({
      queryKey: ["admin", "provider", providerId],
    });
  };

  const applyAwsBootstrapState = (data: {
    config: Record<string, any>;
    summary: AwsSetupSummary;
  }) => {
    refreshProviderQueries();
    settingsDirtyRef.current = false;
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

  const { data: machineProfileData } = useQuery({
    queryKey: ["admin", "machineProfiles", providerId],
    queryFn: () =>
      trpcClient.admin.infrastructure.listMachineProfiles.query({
        cloudProviderId: providerId as string,
      }),
    enabled: !!providerId,
  });
  const machineProfiles = machineProfileData?.profiles;
  const billingEnabled = machineProfileData?.billingEnabled ?? false;

  const setMachineProfilePrice = useMutation({
    mutationFn: (params: { id: string; microsPerHour: number | null }) =>
      trpcClient.admin.infrastructure.setMachineProfilePrice.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "machineProfiles", providerId] });
      toast.success("Price updated for new sessions");
    },
    onError: (error) => toast.error(error.message),
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

  // Saved immediately, like machine profile changes; not part of the credentials form.
  const updateMachineSettings = useMutation({
    mutationFn: (params: {
      id: string;
      location?: string | null;
      machineSelectionPolicy?: { mode: (typeof MACHINE_SELECTION_MODES)[number]["value"] };
    }) => trpcClient.admin.infrastructure.updateProvider.mutate(params),
    onSuccess: () => {
      refreshProviderQueries();
      toast.success("Provider updated");
    },
    onError: (error) => toast.error(error.message),
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
      vcpus: number | null;
      memoryGb: number | null;
      providerOptions: Record<string, unknown>;
      isDefault: boolean;
    }) => trpcClient.admin.infrastructure.createMachineProfile.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "machineProfiles", providerId] });
      setNewMachineProfile(emptyMachineProfile);
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
      taskRoleName?: string;
      taskRole?: AwsRoleSelection;
    }) => trpcClient.admin.aws.bootstrap.mutate(params),
    onSuccess: (data) => {
      applyAwsBootstrapState(data);
      setAwsRoleOverride(null);
      setAwsRoleCheck(data.roleCheck ?? null);
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

  const pinnedAwsRegionIdentifier =
    provider?.providerKey === "aws"
      ? ((provider.regions?.find((region) => region.isEnabled) ?? provider.regions?.[0])
          ?.externalRegionIdentifier ?? "")
      : "";

  // Region rows are excluded (only the pinned AWS region feeds the form). Toggling
  // or adding one refetches the provider, but that is not a new saved configuration.
  const savedSettingsKey = JSON.stringify({
    id: provider?.id ?? null,
    updatedAt: provider?.updatedAt ?? null,
    name: provider?.name ?? null,
    allowUserRegionSelection: provider?.allowUserRegionSelection ?? null,
    providerKey: provider?.providerKey ?? null,
    configId: provider?.providerConfig?.id ?? null,
    configUpdatedAt: provider?.providerConfig?.updatedAt ?? null,
    configName: provider?.providerConfig?.name ?? null,
    configEnabled: provider?.providerConfig?.isEnabled ?? null,
    config: provider?.providerConfig?.config ?? null,
    pinnedAwsRegionIdentifier,
  });

  useEffect(() => {
    if (!provider) {
      return;
    }

    if (hydratedProviderIdRef.current !== provider.id) {
      settingsDirtyRef.current = false;
      hydratedProviderIdRef.current = provider.id;
      appliedSettingsKeyRef.current = "";
    }

    if (appliedSettingsKeyRef.current === savedSettingsKey) {
      return;
    }

    if (settingsDirtyRef.current) {
      return;
    }

    appliedSettingsKeyRef.current = savedSettingsKey;
    setProviderName(provider.name ?? "");
    setAllowUserRegionSelection(provider.allowUserRegionSelection ?? true);
    setConfigName(provider.providerConfig?.name ?? `${provider.name} Default`);
    setConfigEnabled(provider.providerConfig?.isEnabled ?? true);
    setConfigForm((current) =>
      mergePreservedEncryptedFields(
        provider.providerKey,
        {
          ...provider.providerConfig?.config,
          ...(pinnedAwsRegionIdentifier ? { defaultRegion: pinnedAwsRegionIdentifier } : {}),
        },
        current,
      ),
    );
  }, [provider, savedSettingsKey, pinnedAwsRegionIdentifier]);

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

      settingsDirtyRef.current = false;
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
            {field.isEncrypted && <Lock className="size-3.5 text-fg-4" />}
          </div>
          {hasSavedEncryptedValue && (
            <div className="rounded-lg bg-fill px-3 py-2 font-mono text-[13px] text-fg-3">
              {encryptedFieldPreview}
            </div>
          )}
          <Input
            id={field.fieldName}
            type="password"
            placeholder={hasSavedEncryptedValue ? "Enter new value to replace" : field.fieldLabel}
            value={value}
            onChange={(e) => {
              markSettingsDirty();
              setConfigForm((current) => ({
                ...current,
                [field.fieldName]: e.target.value,
              }));
            }}
            required={field.isRequired && !readOnly}
            readOnly={readOnly}
            className={cn(readOnly && "cursor-default")}
          />
          {hasSavedEncryptedValue && (
            <p className="text-[13px] text-fg-3">
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
            {field.isEncrypted && <Lock className="size-3.5 text-fg-4" />}
          </div>
          <Switch
            id={field.fieldName}
            checked={value === true || value === "true"}
            disabled={readOnly}
            onCheckedChange={(checked) => {
              if (readOnly) return;
              markSettingsDirty();
              setConfigForm((current) => ({ ...current, [field.fieldName]: checked }));
            }}
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
            {field.isEncrypted && <Lock className="size-3.5 text-fg-4" />}
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
              onValueChange={(val) => {
                markSettingsDirty();
                setConfigForm((current) => ({ ...current, [field.fieldName]: val }));
              }}
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
            disabled
            className="disabled:cursor-not-allowed disabled:opacity-60"
          />
          {pinnedRegion && (
            <p className="text-[13px] text-fg-3">
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
          {field.isEncrypted && <Lock className="size-3.5 text-fg-4" />}
        </div>
        {hasSavedEncryptedValue && (
          <div className="rounded-lg bg-fill px-3 py-2 font-mono text-[13px] text-fg-3">
            {encryptedFieldPreview}
          </div>
        )}
        <Input
          id={field.fieldName}
          type={field.fieldType === "number" ? "number" : field.fieldType}
          placeholder={hasSavedEncryptedValue ? "Enter new value to replace" : field.fieldLabel}
          value={value}
          onChange={(e) => {
            markSettingsDirty();
            setConfigForm((current) => ({
              ...current,
              [field.fieldName]: e.target.value,
            }));
          }}
          required={field.isRequired && !readOnly}
          readOnly={readOnly}
          className={cn(readOnly && "cursor-default")}
        />
        {hasSavedEncryptedValue && (
          <p className="text-[13px] text-fg-3">
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
  const awsAccountId = /^arn:aws:iam::(\d{12}):/.exec(
    String(provider?.providerConfig?.config.taskRoleArn ?? ""),
  )?.[1];
  const awsRoleSelection: AwsRoleSelection =
    awsRoleOverride ??
    (configForm.taskRoleArn
      ? { mode: "existing", arn: String(configForm.taskRoleArn) }
      : { mode: "create", name: `gitterm-task-${awsDefaultRegion}` });
  const isAwsTaskRoleNameValid = awsRoleSelectionSchema.safeParse(awsRoleSelection).success;
  const awsPublicSshEnabled = configForm.publicSshEnabled !== false;
  const hasSavedAwsCredentials = isAwsProvider && !!provider?.providerConfig;
  const hasEnteredAwsCredentials = awsAccessKeyId.length > 0 && awsSecretAccessKey.length > 0;
  const canRunAwsSimpleSetup =
    !!provider?.id &&
    awsDefaultRegion.length > 0 &&
    isAwsTaskRoleNameValid &&
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
      taskRole: awsRoleSelection,
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
        preserveProvider: true,
      });
      const bootstrapResult = await trpcClient.admin.aws.bootstrap.mutate({
        providerId: provider.id,
        configName: configName.trim() || `${provider.name} Default`,
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
        defaultRegion: awsDefaultRegion,
        publicSshEnabled: awsPublicSshEnabled,
        taskRole: awsRoleSelection,
      });

      applyAwsBootstrapState(bootstrapResult);
      setAwsRoleOverride(null);
      setAwsRoleCheck(bootstrapResult.roleCheck ?? null);
      toast.success(`AWS infrastructure reset (${bootstrapResult.summary.stackName})`);
      setAwsActionDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset AWS infrastructure");
    } finally {
      setIsResettingAwsInfrastructure(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "provider", providerId] });
    }
  };

  if (!ready) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48 bg-fill" />
        </div>
      </DashboardShell>
    );
  }

  const status = provider ? providerStatus(provider) : null;
  const statusText = !provider
    ? ""
    : status?.state === "ready"
      ? "Users can start workspaces here."
      : status?.state === "setup"
        ? provider.providerConfig
          ? "Its credentials are turned off. Turn them on below and save."
          : "Save working credentials below so workspaces can start."
        : provider.providerConfig?.isEnabled
          ? "Hidden from users. Turn it on when you're ready."
          : "Hidden from users. Save working credentials before turning it on.";
  const savedSetupScripts = setupDefaults?.filter((entry) => entry.commands.length > 0).length ?? 0;

  const saveButton = (
    <Button onClick={handleSaveSettings} disabled={!resolvedProviderTypeId || isSavingConfig}>
      {isSavingConfig ? <Loader2 className="animate-spin" /> : null}
      {isSavingConfig ? "Saving…" : "Save settings"}
    </Button>
  );

  return (
    <DashboardShell>
      <DashboardHeader
        heading={provider?.name ?? <span className="sr-only">Loading provider</span>}
        text="General and Credentials save with Save settings. Everything else saves on its own."
        icon={
          provider ? (
            <span className="flex size-10 items-center justify-center rounded-lg bg-fill">
              <Image
                src={getIcon(provider.providerKey)}
                alt=""
                width={20}
                height={20}
                className="size-5 object-contain"
              />
            </span>
          ) : (
            // The name comes with the provider: hold the icon's and title's places until then.
            <>
              <Skeleton className="size-10 rounded-lg bg-fill-2" />
              <Skeleton className="h-8 w-40 bg-fill-2" />
            </>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" className="text-fg-3">
            <Link href={"/admin/providers" as Route}>
              <ChevronLeft />
              All providers
            </Link>
          </Button>
          {saveButton}
        </div>
      </DashboardHeader>

      {isLoadingProvider ? (
        <ProviderSkeleton />
      ) : (
        <div className="space-y-12">
          <Panel>
            <PanelRow className="gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Label htmlFor="provider-enabled" className="text-[14px] font-medium text-fg">
                    Available to users
                  </Label>
                  {status ? <StatusDot tone={status.tone}>{status.label}</StatusDot> : null}
                </div>
                <p className="mt-0.5 text-[13px] text-fg-3">{statusText}</p>
              </div>
              <Switch
                id="provider-enabled"
                checked={provider?.isEnabled}
                disabled={!provider?.isEnabled && !provider?.providerConfig?.isEnabled}
                onCheckedChange={handleToggleProvider}
              />
            </PanelRow>
          </Panel>

          <section className="space-y-4">
            <SectionHeading title="General" />
            <div className={formPanel}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="provider-name">Name</Label>
                  <Input
                    id="provider-name"
                    value={providerName}
                    onChange={(e) => {
                      markSettingsDirty();
                      setProviderName(e.target.value);
                    }}
                    placeholder="Railway"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Input value={selectedProviderType?.displayName ?? "Unknown"} disabled readOnly />
                </div>
              </div>
              {provider?.supportsRegions && (
                <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-5">
                  <div className="space-y-1">
                    <Label htmlFor="region-selection" className="text-[14px] font-medium text-fg">
                      Users pick a region
                    </Label>
                    <p className="text-[13px] text-fg-3">
                      {isAwsProvider
                        ? "AWS always uses the region set in its credentials."
                        : "Off means every workspace runs in the default region."}
                    </p>
                  </div>
                  <Switch
                    id="region-selection"
                    checked={isAwsProvider ? false : allowUserRegionSelection}
                    disabled={isAwsProvider}
                    onCheckedChange={(checked) => {
                      markSettingsDirty();
                      setAllowUserRegionSelection(checked);
                    }}
                  />
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading
              title="Credentials"
              description={
                provider?.providerConfig
                  ? "Encrypted at rest. Leave a secret blank to keep the saved one."
                  : "Nothing saved yet."
              }
            />

            {isAwsProvider && (
              <Panel>
                <PanelRow className="flex-wrap gap-y-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[13px]">
                    <span className="text-fg-3">Stack</span>
                    {hasExistingAwsSetup ? (
                      <StatusDot tone="ok" className="font-mono">
                        {awsSetupSummary?.stackName ?? "Provisioned"}
                      </StatusDot>
                    ) : (
                      <StatusDot tone="muted">Not provisioned</StatusDot>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleAwsSimpleSetup}
                      disabled={!canRunAwsSimpleSetup || isBootstrappingAws || isAwsActionPending}
                    >
                      {isBootstrappingAws ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {hasExistingAwsSetup ? "Apply" : "Provision"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
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
                </PanelRow>
              </Panel>
            )}

            {isAwsProvider && <AwsSetupGuide region={awsDefaultRegion} role={awsRoleSelection} />}

            <Dialog
              open={awsActionDialog !== null}
              onOpenChange={(open) => !open && setAwsActionDialog(null)}
            >
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>
                    {awsActionDialog === "reset"
                      ? "Reset AWS infrastructure"
                      : "Delete AWS infrastructure"}
                  </DialogTitle>
                  <DialogDescription>
                    {awsActionDialog === "reset"
                      ? "GitTerm will delete the shared stack, then provision it again using the saved region and encrypted credentials."
                      : "The shared AWS stack, provider record, and saved credentials will be removed. The task role is retained in IAM."}
                  </DialogDescription>
                </DialogHeader>

                <ol className="divide-y divide-line">
                  {[
                    "All AWS workspaces for this provider must already be deleted.",
                    "Shared EFS data and CloudWatch logs will be deleted. The IAM task role is retained.",
                    awsActionDialog === "reset"
                      ? "Saved access keys remain encrypted and will be reused for the rebuild."
                      : "Saved credentials are removed from GitTerm; the IAM access keys themselves are not revoked.",
                    awsActionDialog === "reset"
                      ? "Provider returns to service as soon as the new stack finishes provisioning."
                      : "Add the AWS region again if you want to rebuild this provider.",
                  ].map((line, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-3 py-2.5 text-[13.5px] leading-relaxed text-fg-2"
                    >
                      <span className="w-4 shrink-0 text-fg-4 tabular-nums">{index + 1}.</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAwsActionDialog(null)}
                    disabled={isAwsActionPending || isBootstrappingAws}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant={awsActionDialog === "reset" ? "default" : "destructive"}
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
                          Confirm reset
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
                        Confirm delete
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className={formPanel}>
              {provider?.providerConfig ? (
                <div className="mb-5 flex items-center justify-between gap-4 border-b border-line pb-5">
                  <div className="space-y-1">
                    <Label htmlFor="config-enabled" className="text-[14px] font-medium text-fg">
                      Use these credentials
                    </Label>
                    <p className="text-[13px] text-fg-3">
                      Off stops new workspaces on this provider.
                    </p>
                  </div>
                  <Switch
                    id="config-enabled"
                    checked={configEnabled}
                    onCheckedChange={(checked) => {
                      markSettingsDirty();
                      setConfigEnabled(checked);
                    }}
                  />
                </div>
              ) : null}
              {!resolvedProviderTypeId && (
                <p className="mb-4 text-[13.5px] text-fg-3">
                  No provider type matches this entry. Check that its key maps to a registered
                  provider type.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="config-name">Configuration name</Label>
                  <Input
                    id="config-name"
                    value={configName}
                    onChange={(e) => {
                      markSettingsDirty();
                      setConfigName(e.target.value);
                    }}
                    placeholder="Railway production"
                  />
                </div>
              </div>

              {resolvedProviderTypeId && isLoadingFields && (
                <div className="mt-4 space-y-4">
                  <Skeleton className="h-12 w-full bg-fill" />
                  <Skeleton className="h-12 w-full bg-fill" />
                </div>
              )}

              {isAwsProvider && (
                <div className="mt-4 max-w-xl space-y-2">
                  <AwsRoleInput
                    id="aws-default-role"
                    value={awsRoleSelection}
                    onChange={setAwsRoleOverride}
                    disabled={isBootstrappingAws || isAwsActionPending}
                    accountId={awsAccountId}
                  />
                  <p className="text-[13px] leading-relaxed text-fg-3">
                    Applied on provision or apply, to new workspaces only. Existing roles stay
                    unchanged.
                  </p>
                  {!isAwsTaskRoleNameValid && (
                    <p className="text-[13px] text-destructive">
                      Enter a valid IAM role ARN or a new role name (up to 64 letters, numbers, or
                      _+=,.@- characters).
                    </p>
                  )}
                  {awsRoleCheck && <AwsRoleCheckResult check={awsRoleCheck} />}
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

              {!isAwsProvider && resolvedProviderTypeId ? (
                <div className="mt-5 flex justify-end border-t border-line pt-4">{saveButton}</div>
              ) : null}
            </div>
          </section>

          {isCloudflareProvider && (
            <section className="space-y-4">
              <SectionHeading
                title="Sandbox worker"
                description="Cloudflare workspaces run behind a Worker in your own account. Deploy it, then paste its URL and the same internal API key into Credentials."
              />
              <div className={formPanel}>
                <ol className="space-y-2.5">
                  {(cloudflareManualSetup?.steps ?? []).map((step, i) => (
                    <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-fg-2">
                      <span className="w-4 shrink-0 text-fg-4 tabular-nums">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {cloudflareManualSetup?.command && (
                  <CopyField
                    label="Deploy command"
                    multiline
                    value={cloudflareManualSetup.command}
                    className="mt-4"
                  />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-4"
                  onClick={downloadWorkerZip}
                  disabled={(cloudflareWorkerFiles?.length ?? 0) === 0}
                >
                  <Download />
                  Download setup ZIP
                </Button>
              </div>
            </section>
          )}

          <ProviderWebhookGuide
            providerKey={providerKey || selectedProviderType?.name || ""}
            providerName={selectedProviderType?.displayName ?? provider?.name ?? "this provider"}
          />

          {isAwsProvider && provider?.providerConfig && providerId && (
            <AwsAccessProfiles
              key={providerId}
              providerId={providerId}
              profiles={awsAccessProfileSchema
                .array()
                .parse(provider.providerConfig.config.accessProfiles ?? [])}
              defaultRoleArn={String(provider.providerConfig.config.taskRoleArn ?? "")}
              disabled={isBootstrappingAws || isAwsActionPending}
            />
          )}

          <section className="space-y-4">
            <SectionHeading
              title="Machine sizes"
              count={machineProfiles?.length || undefined}
              description="Each size has a stable key for the SDK. Free users get the smallest enabled size."
            />

            {provider && (
              <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Size choice</Label>
                  <Seg
                    ariaLabel="Machine size choice"
                    options={MACHINE_SELECTION_MODES.map((mode) => ({
                      value: mode.value,
                      label: mode.label,
                    }))}
                    value={provider.machineSelectionPolicy.mode}
                    onChange={(mode) => {
                      if (mode === provider.machineSelectionPolicy.mode) return;
                      updateMachineSettings.mutate({
                        id: provider.id,
                        machineSelectionPolicy: { mode },
                      });
                    }}
                    className="flex w-full sm:w-fit"
                  />
                  <p className="text-[13px] text-fg-3">
                    Saves right away. Default size only runs every workspace on the default.
                  </p>
                </div>
                {/* Region-capable providers show their regions instead. */}
                {!provider.supportsRegions && (
                  <div className="space-y-2">
                    <Label htmlFor="provider-location">Location shown to users</Label>
                    <Input
                      key={provider.location ?? ""}
                      id="provider-location"
                      defaultValue={provider.location ?? ""}
                      placeholder="EU"
                      onBlur={(event) => {
                        const location = event.target.value.trim() || null;
                        if (location !== provider.location) {
                          updateMachineSettings.mutate({ id: provider.id, location });
                        }
                      }}
                    />
                    <p className="text-[13px] text-fg-3">
                      Optional. Where your provider account runs sandboxes.
                    </p>
                  </div>
                )}
              </div>
            )}

            {machineProfiles && machineProfiles.length > 0 ? (
              <Panel className="max-h-[36rem] overflow-y-auto">
                {machineProfiles.map((profile) => {
                  const unpriced = billingEnabled && profile.priceMicrosPerHour === null;
                  const options = Object.entries(profile.providerOptions)
                    .map(
                      ([key, value]) =>
                        `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
                    )
                    .join(" ");
                  return (
                    <PanelRow
                      key={profile.id}
                      className="flex-col items-stretch md:flex-row md:items-center"
                    >
                      <div className={cn("min-w-0 flex-1", !profile.isEnabled && "opacity-50")}>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-[14px] font-medium text-fg">{profile.name}</span>
                          <span className="font-mono text-[12.5px] text-fg-4">{profile.key}</span>
                          {profile.isDefault && <StatusDot tone="busy">Default</StatusDot>}
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-fg-3">
                          {[formatMachineSize(profile), options || "Provider-managed resources"]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {unpriced && (
                          <p className="mt-0.5 text-[13px] text-[#fb923c]">
                            No price yet, so it can't start.
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 max-md:justify-between">
                        {billingEnabled && (
                          <div className="relative w-28">
                            <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px] text-fg-3">
                              $
                            </span>
                            <Input
                              key={profile.priceMicrosPerHour ?? "unpriced"}
                              type="number"
                              min={0}
                              step="0.001"
                              className={cn(
                                "h-8 pr-8 pl-6 font-mono text-[13px] tabular-nums",
                                unpriced && "ring-1 ring-[#fb923c]/50",
                              )}
                              aria-label={`${profile.name} price per hour`}
                              placeholder="–"
                              defaultValue={
                                profile.priceMicrosPerHour === null
                                  ? ""
                                  : profile.priceMicrosPerHour / 1_000_000
                              }
                              onBlur={(event) => {
                                const value = event.target.value.trim();
                                const microsPerHour =
                                  value === "" ? null : Math.round(Number(value) * 1_000_000);
                                if (microsPerHour !== null && !Number.isFinite(microsPerHour))
                                  return;
                                if (microsPerHour !== profile.priceMicrosPerHour) {
                                  setMachineProfilePrice.mutate({
                                    id: profile.id,
                                    microsPerHour,
                                  });
                                }
                              }}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[13px] text-fg-3">
                              /h
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {/* Fixed slot so the switches line up whether or not a row is the default. */}
                          <div className="flex w-[6.5rem] justify-end">
                            {!profile.isDefault && profile.isEnabled && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-fg-3"
                                onClick={() =>
                                  updateMachineProfile.mutate({ id: profile.id, isDefault: true })
                                }
                              >
                                Make default
                              </Button>
                            )}
                          </div>
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
                            className="size-8 text-fg-3 hover:text-destructive"
                            onClick={() => deleteMachineProfile.mutate(profile.id)}
                            aria-label={`Delete ${profile.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </PanelRow>
                  );
                })}
              </Panel>
            ) : null}

            {machineFields.length > 0 ? (
              <div className={formPanel}>
                <p className="mb-4 text-[14px] font-medium text-fg">New size</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="machine-name">Name</Label>
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
                      <p className="text-[13px] text-fg-3">
                        SDK key <code className="font-mono text-fg-2">{newMachineProfileKey}</code>
                      </p>
                    )}
                    {duplicateMachineProfile && (
                      <p className="text-[13px] text-destructive">
                        A size named {duplicateMachineProfile.name} already exists.
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="machine-vcpus">vCPUs</Label>
                      <Input
                        id="machine-vcpus"
                        type="number"
                        value={newMachineProfile.vcpus}
                        placeholder="4"
                        onChange={(event) =>
                          setNewMachineProfile((current) => ({
                            ...current,
                            vcpus: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="machine-memory">Memory (GB)</Label>
                      <Input
                        id="machine-memory"
                        type="number"
                        value={newMachineProfile.memoryGb}
                        placeholder="8"
                        onChange={(event) =>
                          setNewMachineProfile((current) => ({
                            ...current,
                            memoryGb: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <p className="col-span-2 text-[13px] text-fg-3">
                      What the provider really provisions. Shown to users.
                    </p>
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
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
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
                <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
                  <label className="flex items-center gap-2.5 text-[13px] text-fg-2">
                    <Switch
                      checked={newMachineProfile.isDefault}
                      onCheckedChange={(isDefault) =>
                        setNewMachineProfile((current) => ({ ...current, isDefault }))
                      }
                    />
                    Make it the default
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
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
                        vcpus: Number(newMachineProfile.vcpus) || null,
                        memoryGb: Number(newMachineProfile.memoryGb) || null,
                      })
                    }
                  >
                    {createMachineProfile.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Plus />
                    )}
                    Add size
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[13.5px] text-fg-3">
                {provider?.name} sets machine resources itself, so there are no sizes to add here.
              </p>
            )}
          </section>

          {provider?.supportsRegions && !isAwsProvider && (
            <section className="space-y-4">
              <SectionHeading
                title="Regions"
                count={provider.regions?.length || undefined}
                description="Turning a region off hides it from new workspaces."
              />
              {provider.regions?.length ? (
                <Panel className="max-h-[28rem] overflow-y-auto">
                  {provider.regions.map((region) => (
                    <PanelRow key={region.id}>
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                        <MapPin className="size-4 text-fg-3" />
                      </span>
                      <div className={cn("min-w-0 flex-1", !region.isEnabled && "opacity-60")}>
                        <p className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-[14px] font-medium text-fg">
                            {region.name}
                          </span>
                          <span className="shrink-0 font-mono text-[12.5px] text-fg-4">
                            {region.externalRegionIdentifier}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-[13px] text-fg-3">{region.location}</p>
                      </div>
                      <Switch
                        checked={region.isEnabled}
                        aria-label={`${region.isEnabled ? "Disable" : "Enable"} ${region.name}`}
                        onCheckedChange={(checked) =>
                          toggleRegion.mutate({
                            id: region.id,
                            isEnabled: checked,
                          })
                        }
                      />
                    </PanelRow>
                  ))}
                </Panel>
              ) : null}

              <div className={formPanel}>
                <p className="mb-4 text-[14px] font-medium text-fg">New region</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="region-name">Name</Label>
                    <Input
                      id="region-name"
                      value={newRegion.name}
                      onChange={(e) => setNewRegion({ ...newRegion, name: e.target.value })}
                      placeholder="US West"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={newRegion.location}
                      onChange={(e) => setNewRegion({ ...newRegion, location: e.target.value })}
                      placeholder="California"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="external-id">Provider ID</Label>
                    <Input
                      id="external-id"
                      value={newRegion.externalRegionIdentifier}
                      onChange={(e) =>
                        setNewRegion({
                          ...newRegion,
                          externalRegionIdentifier: e.target.value,
                        })
                      }
                      placeholder="us-west-2"
                      className="font-mono text-[13px]"
                    />
                  </div>
                </div>
                <div className="mt-5 flex justify-end border-t border-line pt-4">
                  <Button
                    variant="secondary"
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
                    {createRegion.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                    Add region
                  </Button>
                </div>
              </div>
            </section>
          )}

          <section className="space-y-4">
            <SectionHeading
              title="Setup script"
              count={savedSetupScripts || undefined}
              description="Runs in the repository after the agent starts. A failure never blocks the workspace."
            />
            <div className={cn(formPanel, "space-y-4")}>
              <div className="max-w-sm space-y-2">
                <Label>Applies to</Label>
                <Select value={setupAgentTypeId} onValueChange={setSetupAgentTypeId}>
                  <SelectTrigger className="w-full">
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
                  className="min-h-36 font-mono text-[13px]"
                  spellCheck={false}
                />
                <p className="text-[13px] text-fg-3">
                  Runs before commands sent through the SDK. Logs go to{" "}
                  <code className="font-mono text-fg-2">~/.gitterm/setup</code>.
                </p>
              </div>
              <div className="flex justify-end border-t border-line pt-4">
                <Button
                  type="button"
                  variant="secondary"
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
                  Save script
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </DashboardShell>
  );
}

/** A labelled input as it loads. */
function fieldSkeleton(key: number) {
  return (
    <div key={key} className="space-y-2">
      <Skeleton className="h-3.5 w-20 bg-fill-2" />
      <Skeleton className="h-10 w-full rounded-lg bg-fill-2" />
    </div>
  );
}

/** The page's shape while the provider loads: availability, then its headed sections. */
function ProviderSkeleton() {
  return (
    <div className="space-y-12">
      <Panel>
        <PanelRow className="gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 bg-fill-2" />
            <Skeleton className="h-3.5 w-72 max-w-full bg-fill-2" />
          </div>
          <Skeleton className="h-5 w-9 shrink-0 rounded-full bg-fill-2" />
        </PanelRow>
      </Panel>

      <section className="space-y-4">
        <SectionHeading title="General" />
        <div className={`${formPanel} grid grid-cols-1 gap-4 md:grid-cols-2`}>
          {[0, 1].map(fieldSkeleton)}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Credentials" />
        <div className={`${formPanel} space-y-4`}>
          <Skeleton className="h-3.5 w-80 max-w-full bg-fill-2" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{[0, 1].map(fieldSkeleton)}</div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading title="Machine sizes" />
        <Panel>
          {[0, 1, 2].map((i) => (
            <PanelRow key={i}>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-28 bg-fill-2" />
                <Skeleton className="h-3.5 w-40 bg-fill-2" />
              </div>
              <Skeleton className="h-8 w-24 shrink-0 rounded-lg bg-fill-2" />
            </PanelRow>
          ))}
        </Panel>
      </section>
    </div>
  );
}

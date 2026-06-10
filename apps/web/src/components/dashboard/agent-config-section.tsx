"use client";

import { useState, useEffect } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Check,
  Code2,
  Edit3,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { useTheme } from "next-themes";

const ICON_MAP: Record<string, string> = {
  opencode: "/opencode.svg",
  shuvcode: "/shuvcode.svg",
  claude: "/code.svg",
};

const getIcon = (name: string) => {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(ICON_MAP)) {
    if (key.includes(k)) return v;
  }
  return "/opencode.svg";
};

const EXAMPLE_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "opencode",
  "model": "opencode/big-pickle",
  "autoupdate": true
}`;

type ConfigFormData = {
  id?: string;
  name: string;
  agentTypeId: string;
  configJson: string;
};

const initialFormState: ConfigFormData = {
  name: "",
  agentTypeId: "",
  configJson: "",
};

export function AgentConfigSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<ConfigFormData>(initialFormState);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const { theme } = useTheme();
  const { data: agentTypesData } = useQuery(trpc.workspace.listAgentTypes.queryOptions());

  const { data: configurationsData, isLoading: isLoadingConfigs } = useQuery(
    trpc.user.listAgentConfigurations.queryOptions(),
  );

  // Set default agent type when data loads
  useEffect(() => {
    if (!formData.agentTypeId && agentTypesData?.agentTypes?.[0]) {
      setFormData((prev) => ({
        ...prev,
        agentTypeId: agentTypesData.agentTypes[0].id,
      }));
    }
  }, [agentTypesData, formData.agentTypeId]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!dialogOpen) {
      setFormData((prev) => ({
        ...initialFormState,
        agentTypeId: prev.agentTypeId || agentTypesData?.agentTypes?.[0]?.id || "",
      }));
      setJsonError(null);
      setIsEditing(false);
    }
  }, [dialogOpen, agentTypesData]);

  // Validate JSON as user types
  useEffect(() => {
    if (!formData.configJson.trim()) {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(formData.configJson);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON format");
    }
  }, [formData.configJson]);

  const invalidateConfigs = () => {
    queryClient.invalidateQueries({
      queryKey: [["user", "listAgentConfigurations"]],
    });
  };

  const { mutate: addConfig, isPending: isAdding } = useMutation(
    trpc.user.addAgentConfiguration.mutationOptions({
      onSuccess: () => {
        toast.success("Configuration created successfully");
        setDialogOpen(false);
        invalidateConfigs();
      },
      onError: (error) => {
        toast.error(`Failed to create configuration: ${error.message}`);
      },
    }),
  );

  const { mutate: updateConfig, isPending: isUpdating } = useMutation(
    trpc.user.updateAgentConfiguration.mutationOptions({
      onSuccess: () => {
        toast.success("Configuration updated successfully");
        setDialogOpen(false);
        invalidateConfigs();
      },
      onError: (error) => {
        toast.error(`Failed to update configuration: ${error.message}`);
      },
    }),
  );

  const { mutate: deleteConfig, isPending: isDeleting } = useMutation(
    trpc.user.deleteAgentConfiguration.mutationOptions({
      onSuccess: () => {
        toast.success("Configuration deleted");
        setDeleteDialogOpen(false);
        setConfigToDelete(null);
        invalidateConfigs();
      },
      onError: (error) => {
        toast.error(`Failed to delete configuration: ${error.message}`);
      },
    }),
  );

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error("Please enter a configuration name");
      return;
    }

    if (!formData.agentTypeId) {
      toast.error("Please select an agent type");
      return;
    }

    if (!formData.configJson.trim()) {
      toast.error("Please enter a configuration");
      return;
    }

    try {
      const parsedConfig = JSON.parse(formData.configJson);

      if (isEditing && formData.id) {
        updateConfig({
          id: formData.id,
          name: formData.name,
          config: parsedConfig,
        });
      } else {
        addConfig({
          name: formData.name,
          agentTypeId: formData.agentTypeId,
          config: parsedConfig,
        });
      }
    } catch {
      toast.error("Invalid JSON configuration");
    }
  };

  const handleEdit = (config: {
    id: string;
    name: string;
    agentTypeId: string;
    config: unknown;
  }) => {
    setFormData({
      id: config.id,
      name: config.name,
      agentTypeId: config.agentTypeId,
      configJson: JSON.stringify(config.config, null, 2),
    });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleDeleteClick = (id: string) => {
    setConfigToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (configToDelete) {
      deleteConfig({ id: configToDelete });
    }
  };

  const handleLoadExample = () => {
    setFormData((prev) => ({ ...prev, configJson: EXAMPLE_CONFIG }));
  };

  const selectedAgentName =
    agentTypesData?.agentTypes?.find((a) => a.id === formData.agentTypeId)?.name || "Agent";

  const isPending = isAdding || isUpdating;
  const configurations = configurationsData?.configurations || [];

  const addConfigDialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
          <Plus className="h-3.5 w-3.5" />
          Add configuration
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0 p-0 sm:max-w-[600px] max-h-[90vh] overflow-hidden">
        <DialogHeader className="space-y-0 border-b border-white/[0.06] bg-white/[0.015] px-5 py-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            {isEditing ? "Edit / Configuration" : "New / Configuration"}
          </span>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04]">
              <Image
                src={getIcon(selectedAgentName)}
                alt={selectedAgentName}
                width={18}
                height={18}
                className="h-[18px] w-[18px]"
              />
            </span>
            <div className="min-w-0">
              <DialogTitle>
                {isEditing ? "Edit configuration" : "New agent configuration"}
              </DialogTitle>
              <DialogDescription className="mt-0.5">
                {isEditing
                  ? `Update the ${selectedAgentName} configuration.`
                  : "Saved opencode.json presets, applied when creating workspaces."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid max-h-[calc(90vh-180px)] gap-5 overflow-y-auto px-5 py-5">
          {/* Test locally hint -- compact, inline */}
          {!isEditing && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-400/85">
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              Test your config locally with{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-mono text-white/85">
                opencode.json
              </code>{" "}
              before adding it here.
            </p>
          )}

          {/* Name + Agent type -- side by side */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                Name
              </Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., MCP Setup, TS Project"
              />
            </div>

            <div className="grid gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                Agent type
                {isEditing && <span className="ml-1 normal-case text-white/30">(locked)</span>}
              </Label>
              <div className="flex flex-wrap gap-2">
                {agentTypesData?.agentTypes?.map((agent) => {
                  const isSelected = formData.agentTypeId === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, agentTypeId: agent.id }))}
                      disabled={isEditing}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        isSelected
                          ? "border-primary/60 bg-primary/15 text-foreground ring-1 ring-primary/25"
                          : "border-white/[0.08] bg-white/[0.05] text-white/75 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <Image
                        src={getIcon(agent.name)}
                        alt={agent.name}
                        width={16}
                        height={16}
                        className="h-4 w-4"
                      />
                      {agent.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* JSON Configuration Input */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                Configuration{" "}
                <a
                  href="https://opencode.ai/docs/config/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 normal-case text-primary/70 hover:text-primary hover:underline"
                >
                  docs
                </a>
              </Label>
              {!formData.configJson.trim() && (
                <button
                  type="button"
                  onClick={handleLoadExample}
                  className="text-xs text-white/40 transition-colors hover:text-white/70"
                >
                  Load example
                </button>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-white/[0.08]">
              <CodeMirror
                value={formData.configJson}
                height="220px"
                extensions={[json()]}
                onChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    configJson: value,
                  }))
                }
                theme={theme as "light" | "dark"}
                placeholder={EXAMPLE_CONFIG}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                }}
                className="text-sm"
              />
            </div>

            {jsonError ? (
              <div className="flex items-center gap-1.5 text-xs text-red-500">
                <AlertCircle className="h-3.5 w-3.5" />
                {jsonError}
              </div>
            ) : formData.configJson.trim() ? (
              <div className="flex items-center gap-1.5 text-xs text-green-500">
                <Check className="h-3.5 w-3.5" />
                Valid JSON
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-white/[0.06] bg-white/[0.015] px-5 py-3.5">
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending || !!jsonError || !formData.configJson.trim() || !formData.name.trim()
            }
            className="gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEditing ? "Saving..." : "Creating..."}
              </>
            ) : isEditing ? (
              "Save changes"
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <SettingsSection
        eyebrow="02 / Agents"
        icon={Settings}
        title="Agent configurations"
        description="Save named opencode.json presets and apply them when creating new workspaces."
        action={addConfigDialog}
      >
        <SettingsSectionBody>
          {isLoadingConfigs ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full bg-white/[0.04]" />
              <Skeleton className="h-14 w-full bg-white/[0.04]" />
            </div>
          ) : configurations.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-input/40 px-6 py-10 text-center">
              <Code2 className="mb-3 h-8 w-8 text-white/25" />
              <p className="text-sm text-white/65">No configurations yet</p>
              <p className="mt-1 text-[12px] text-white/35">
                Save your first opencode.json preset to reuse it across workspaces.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {configurations.map((config) => (
                <div
                  key={config.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-input/60 px-4 py-3 transition-colors hover:bg-input"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Image
                        src={getIcon(config.agentTypeName || "") || "/opencode.svg"}
                        alt={config.agentTypeName || "Agent"}
                        width={20}
                        height={20}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{config.name}</p>
                        <Badge variant="secondary" className="text-xs">
                          {config.agentTypeName}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Updated{" "}
                        {new Date(config.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          handleEdit({
                            id: config.id,
                            name: config.name,
                            agentTypeId: config.agentTypeId,
                            config: config.config,
                          })
                        }
                      >
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeleteClick(config.id)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </SettingsSectionBody>
      </SettingsSection>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Configuration</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this configuration? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

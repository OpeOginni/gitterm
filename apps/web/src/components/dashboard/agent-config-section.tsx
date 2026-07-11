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
import { AGENT_CONFIG_KIND_META, AGENT_CONFIG_KINDS, type AgentConfigKind } from "@gitterm/schema";

type ConfigFormData = {
  id?: string;
  name: string;
  kind: AgentConfigKind;
  configJson: string;
};

const initialFormState: ConfigFormData = {
  name: "",
  kind: "opencode",
  configJson: "",
};

function kindLabel(kind: string | null | undefined): string {
  if (!kind) return "Agent";
  return AGENT_CONFIG_KIND_META[kind as AgentConfigKind]?.label ?? kind;
}

function kindIcon(kind: string | null | undefined): string {
  if (!kind) return "/opencode.svg";
  return AGENT_CONFIG_KIND_META[kind as AgentConfigKind]?.icon ?? "/opencode.svg";
}

function kindAppliesTo(kind: string | null | undefined): string {
  if (!kind) return "";
  const meta = AGENT_CONFIG_KIND_META[kind as AgentConfigKind];
  if (!meta) return "";
  return meta.appliesTo
    .map((p) => (p === "opencode" ? "OpenCode" : p === "t3code" ? "T3Code" : p))
    .join(", ");
}

export function AgentConfigSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<ConfigFormData>(initialFormState);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const { theme } = useTheme();

  const { data: configurationsData, isLoading: isLoadingConfigs } = useQuery(
    trpc.user.listAgentConfigurations.queryOptions(),
  );

  // Reset form when dialog closes
  useEffect(() => {
    if (!dialogOpen) {
      const resetTimer = window.setTimeout(() => {
        setFormData(initialFormState);
        setJsonError(null);
        setIsEditing(false);
      }, 250);

      return () => window.clearTimeout(resetTimer);
    }
  }, [dialogOpen]);

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

  const selectedMeta = AGENT_CONFIG_KIND_META[formData.kind];

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error("Please enter a configuration name");
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
          kind: formData.kind,
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
    kind: AgentConfigKind;
    config: unknown;
  }) => {
    setFormData({
      id: config.id,
      name: config.name,
      kind: config.kind,
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
    setFormData((prev) => ({
      ...prev,
      configJson: JSON.stringify(AGENT_CONFIG_KIND_META[prev.kind].example, null, 2),
    }));
  };

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
      <DialogContent className="grid h-[min(700px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-surface-2 p-0 sm:max-w-[760px]">
        <DialogHeader className="space-y-0 border-b border-white/[0.07] px-6 py-5 sm:px-7">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            {isEditing ? "Edit / Configuration" : "New / Configuration"}
          </span>
          <div className="mt-3 flex items-center gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.08]">
              <Image
                src={selectedMeta.icon}
                alt={selectedMeta.label}
                width={18}
                height={18}
                className="h-[18px] w-[18px]"
              />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-xl font-medium tracking-[-0.025em]">
                {isEditing ? "Edit configuration" : "New agent configuration"}
              </DialogTitle>
              <DialogDescription className="mt-0.5">
                {isEditing
                  ? `Update the ${selectedMeta.label} configuration.`
                  : selectedMeta.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 overflow-y-auto sm:grid-cols-[220px_minmax(0,1fr)] sm:overflow-hidden">
          <aside className="border-b border-border bg-white/[0.015] p-4 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-5">
            <Label className="mb-3 block font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
              Runtime
            </Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
              {AGENT_CONFIG_KINDS.map((kind) => {
                const meta = AGENT_CONFIG_KIND_META[kind];
                const isSelected = formData.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        kind,
                        configJson: prev.kind === kind ? prev.configJson : "",
                      }))
                    }
                    disabled={isEditing}
                    className={`group flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${isSelected ? "border-primary/35 bg-primary/[0.09] text-white shadow-[inset_3px_0_0_hsl(var(--primary))]" : "border-transparent text-white/50 hover:border-white/10 hover:bg-white/[0.035] hover:text-white/80"} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Image
                      src={meta.icon}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{meta.label}</span>
                      <span className="mt-0.5 hidden truncate text-[10px] text-white/30 sm:block">
                        {kindAppliesTo(kind)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="grid content-start gap-5 p-5 sm:overflow-y-auto sm:p-6">
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

            {!isEditing && (
              <div className="flex items-start gap-2.5 border-l border-amber-400/35 pl-3 text-[11px] leading-relaxed text-white/40">
                <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                <span>
                  Validate locally at{" "}
                  <code className="font-mono text-white/70">{selectedMeta.testHint}</code> before
                  saving.
                </span>
              </div>
            )}

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                  Configuration{" "}
                  {selectedMeta.docsUrl && (
                    <a
                      href={selectedMeta.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 normal-case text-primary/70 hover:text-primary hover:underline"
                    >
                      docs
                    </a>
                  )}
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

              <div className="overflow-hidden rounded-xl border border-border bg-input/40">
                <CodeMirror
                  value={formData.configJson}
                  height="260px"
                  extensions={[json()]}
                  onChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      configJson: value,
                    }))
                  }
                  theme={theme as "light" | "dark"}
                  placeholder={JSON.stringify(selectedMeta.example, null, 2)}
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
        </div>

        <DialogFooter className="border-t border-border bg-white/[0.015] px-6 py-4">
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
        eyebrow="03 / Agents"
        icon={Settings}
        title="Agent configurations"
        description="Save OpenCode, Claude Code, and Codex configs. Each is applied to the related workspaces on create."
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
                Save OpenCode, Claude Code, or Codex configs to reuse across workspaces.
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
                        src={kindIcon(config.kind)}
                        alt={kindLabel(config.kind)}
                        width={20}
                        height={20}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{config.name}</p>
                        <Badge variant="secondary" className="text-xs">
                          {kindLabel(config.kind)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {kindAppliesTo(config.kind) ? `→ ${kindAppliesTo(config.kind)} · ` : ""}
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
                            kind: config.kind as AgentConfigKind,
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

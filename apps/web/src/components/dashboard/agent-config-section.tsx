"use client";

import { useState, useEffect } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { SettingsEmpty, settingsLabel } from "@/components/dashboard/settings/settings-page";
import { SectionHeading } from "@/components/dashboard/kit";
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

import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Code2,
  Edit3,
  Loader2,
  MoreHorizontal,
  Plus,
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

function invalidateConfigs() {
  queryClient.invalidateQueries({
    queryKey: [["user", "listAgentConfigurations"]],
  });
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
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add configuration
        </Button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-line bg-settings-dialog p-0 sm:max-w-[760px]">
        <DialogHeader className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fill-2">
              <Image
                src={selectedMeta.icon}
                alt={selectedMeta.label}
                width={18}
                height={18}
                className="h-[18px] w-[18px]"
              />
            </span>
            <div className="min-w-0">
              <DialogTitle>
                {isEditing ? "Edit configuration" : "New agent configuration"}
              </DialogTitle>
              <DialogDescription>
                {isEditing
                  ? `Update the ${selectedMeta.label} configuration.`
                  : selectedMeta.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 overflow-y-auto sm:grid-cols-[220px_minmax(0,1fr)] sm:overflow-hidden">
          <aside className="min-w-0 border-b border-line bg-fill p-4 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-5">
            <Label className={`mb-3 block ${settingsLabel}`}>Agent</Label>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-1 sm:overflow-visible sm:px-0 sm:pb-0">
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
                    className={`group flex w-[9rem] min-w-0 shrink-0 items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors sm:w-auto ${isSelected ? "bg-fill-2 text-fg" : "text-fg-3 hover:bg-fill hover:text-fg"} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Image
                      src={meta.icon}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{meta.label}</span>
                      <span className="mt-0.5 hidden truncate text-[12.5px] text-fg-4 sm:block">
                        {kindAppliesTo(kind)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="grid content-start gap-5 p-4 sm:overflow-y-auto sm:p-6">
            <div className="grid gap-2">
              <Label className={settingsLabel}>Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., MCP Setup, TS Project"
              />
            </div>

            {!isEditing && (
              <div className="flex items-start gap-2.5 rounded-xl bg-fill px-3.5 py-2.5 text-[13px] leading-relaxed text-fg-3">
                <Terminal className="mt-0.5 size-3.5 shrink-0 text-fg-4" />
                <span>
                  Validate locally at{" "}
                  <code className="font-mono text-fg-2">{selectedMeta.testHint}</code> before
                  saving.
                </span>
              </div>
            )}

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className={settingsLabel}>
                  Configuration{" "}
                  {selectedMeta.docsUrl && (
                    <a
                      href={selectedMeta.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 inline-flex items-center gap-0.5 font-normal text-primary hover:underline"
                    >
                      docs
                      <ArrowUpRight className="size-3" />
                    </a>
                  )}
                </Label>
                {!formData.configJson.trim() && (
                  <button
                    type="button"
                    onClick={handleLoadExample}
                    className="text-[13px] text-fg-3 transition-colors hover:text-fg"
                  >
                    Load example
                  </button>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-line bg-input/40">
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
                <div className="flex items-center gap-1.5 text-[13px] text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {jsonError}
                </div>
              ) : formData.configJson.trim() ? (
                <div className="flex items-center gap-1.5 text-[13px] text-[#6bd586]">
                  <Check className="h-3.5 w-3.5" />
                  Valid JSON
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="m-0">
          <Button variant="secondary" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending || !!jsonError || !formData.configJson.trim() || !formData.name.trim()
            }
            className="gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEditing ? "Saving…" : "Creating…"}
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
    <section className="space-y-4">
      <SectionHeading
        title="Configurations"
        count={configurations.length || undefined}
        action={addConfigDialog}
      />
      <p className="-mt-1 max-w-2xl text-[13.5px] leading-relaxed text-fg-3">
        OpenCode, Claude Code and Codex configs, applied to matching workspaces when they start.
      </p>
      {isLoadingConfigs ? (
        <div className="space-y-px overflow-hidden rounded-xl border border-line">
          <Skeleton className="h-[66px] w-full rounded-none bg-fill" />
          <Skeleton className="h-[66px] w-full rounded-none bg-fill" />
        </div>
      ) : configurations.length === 0 ? (
        <div className="rounded-xl border border-line px-4 py-4 sm:px-5">
          <SettingsEmpty
            icon={<Code2 />}
            title="No configurations yet"
            description="Save one to reuse your MCP servers, rules and permissions in every workspace."
          />
        </div>
      ) : (
        <ul className="max-h-[560px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {configurations.map((config) => (
            <li
              key={config.id}
              className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-fill sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                  <Image
                    src={kindIcon(config.kind)}
                    alt={kindLabel(config.kind)}
                    width={18}
                    height={18}
                    className="size-[18px]"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="truncate text-[14px] font-medium text-fg">{config.name}</p>
                    <span className="text-[12.5px] text-fg-3">{kindLabel(config.kind)}</span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-fg-3">
                    {kindAppliesTo(config.kind)
                      ? `For ${kindAppliesTo(config.kind)} agents · `
                      : ""}
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0"
                    aria-label={`Actions for ${config.name}`}
                  >
                    <MoreHorizontal className="size-4" />
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
                    <Edit3 className="mr-2 size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => handleDeleteClick(config.id)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-line bg-settings-dialog sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete configuration</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this configuration? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
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
                  Deleting…
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
    </section>
  );
}

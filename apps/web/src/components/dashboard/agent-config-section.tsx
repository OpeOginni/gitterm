"use client";

import { useState, useEffect } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  "model": "anthropic/claude-sonnet-4-5",
  "autoupdate": true,
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

  return (
    <Card className="mb-4 border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Agent Configurations</CardTitle>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Configuration
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Code2 className="h-5 w-5" />
                  {isEditing ? "Edit Configuration" : "Add Agent Configuration"}
                </DialogTitle>
                <DialogDescription>
                  {isEditing
                    ? "Update your agent configuration settings."
                    : "Create a named configuration for your agent. Test it locally first before adding it here."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 py-4">
                {/* Important Notice - only show for new configs */}
                {!isEditing && (
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <Terminal className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                        Test Locally First
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Before adding your configuration here, test it locally by creating a{" "}
                        <code className="px-1 py-0.5 bg-muted rounded text-[11px]">
                          opencode.json
                        </code>{" "}
                        file in your project root and running the agent. Once verified, paste the
                        working configuration below.
                      </p>
                    </div>
                  </div>
                )}

                {/* Configuration Name */}
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Configuration Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., My MCP Setup, TypeScript Project, etc."
                    className="bg-secondary/30 border-border/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Give your configuration a memorable name
                  </p>
                </div>

                {/* Agent Type Selection */}
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Agent Type</Label>
                  <Select
                    value={formData.agentTypeId}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, agentTypeId: value }))
                    }
                    disabled={isEditing}
                  >
                    <SelectTrigger className="bg-secondary/30 border-border/50">
                      <SelectValue placeholder="Select agent type" />
                    </SelectTrigger>
                    <SelectContent>
                      {agentTypesData?.agentTypes?.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          <div className="flex items-center">
                            <Image
                              src={getIcon(agent.name) || "/placeholder.svg"}
                              alt={agent.name}
                              width={16}
                              height={16}
                              className="mr-2 h-4 w-4"
                            />
                            {agent.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {isEditing
                      ? "Agent type cannot be changed after creation"
                      : "Select the agent type this configuration applies to"}
                  </p>
                </div>

                {/* JSON Configuration Input */}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Configuration (JSON)</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleLoadExample}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Load Example
                    </Button>
                  </div>

                  <CodeMirror
                    value={formData.configJson}
                    height="240px"
                    extensions={[json()]}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        configJson: value,
                      }))
                    }
                    theme={theme as "light" | "dark"}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                    }}
                  />

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

                {/* Configuration Help */}
                <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50">
                  <p>
                    For configuration options and documentation, see{" "}
                    <a
                      href="https://opencode.ai/docs/config/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-medium"
                    >
                      OpenCode Config Documentation
                    </a>
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="border-border/50"
                >
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
                      {isEditing ? "Updating..." : "Creating..."}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {isEditing ? "Update Configuration" : "Create Configuration"}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>
          Create and manage named configurations for your AI coding agents. These can be applied
          when creating new workspaces.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingConfigs ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : configurations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Code2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No configurations yet</p>
            <p className="text-xs mt-1">Create your first configuration to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {configurations.map((config) => (
              <div
                key={config.id}
                className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/30 transition-colors"
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
      </CardContent>

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
    </Card>
  );
}

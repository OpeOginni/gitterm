"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow, StatusDot } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { useAdminGuard } from "../_components/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Container, Plus, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsEmpty } from "@/components/dashboard/settings/settings-page";

const PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS",
  e2b: "E2B",
  daytona: "Daytona",
  cloudflare: "Cloudflare",
  vercel: "Vercel",
  boat: "Boat",
  exedev: "exe.dev",
  railway: "Railway",
};

export default function AgentTypesPage() {
  const { ready } = useAdminGuard();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);

  const [newAgent, setNewAgent] = useState({
    key: "",
    name: "",
    description: "",
    provisionerKey: "opencode" as "opencode" | "t3code",
    serverOnly: false,
  });

  const { data: agentTypes, isLoading } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
  });

  const { data: images, isLoading: isImagesLoading } = useQuery({
    queryKey: ["admin", "images"],
    queryFn: () => trpcClient.admin.infrastructure.listImages.query(),
  });

  const createAgentType = useMutation({
    mutationFn: (params: {
      key: string;
      name: string;
      description?: string;
      provisionerKey: "opencode" | "t3code";
      serverOnly: boolean;
    }) => trpcClient.admin.infrastructure.createAgentType.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "agentTypes"] });
      setIsCreateOpen(false);
      setNewAgent({
        key: "",
        name: "",
        description: "",
        provisionerKey: "opencode",
        serverOnly: false,
      });
      toast.success("Agent type created");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleAgentType = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleAgentType.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "agentTypes"] });
      toast.success(`Agent type ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteAgentType = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      trpcClient.admin.infrastructure.deleteAgentType.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "agentTypes"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      setDeleteAgentId(null);
      toast.success("Agent type deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  // Don't render content if not authenticated or not admin (will redirect)
  if (!ready) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48 bg-fill" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Agents"
        text="The agents users can run in a workspace, and the images behind them."
      >
        <div className="flex">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5 self-start">
                <Plus className="size-4" />
                Add agent
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add agent</DialogTitle>
                <DialogDescription>
                  An agent users can pick when creating a workspace.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Agent name</Label>
                  <Input
                    id="name"
                    value={newAgent.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setNewAgent((current) => {
                        const previousAutoKey = current.name
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "");
                        return {
                          ...current,
                          name,
                          key:
                            !current.key || current.key === previousAutoKey
                              ? name
                                  .toLowerCase()
                                  .replace(/[^a-z0-9]+/g, "-")
                                  .replace(/^-|-$/g, "")
                              : current.key,
                        };
                      });
                    }}
                    placeholder="OpenCode (TTYD)"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="key">SDK key</Label>
                    <Input
                      id="key"
                      value={newAgent.key}
                      onChange={(e) => setNewAgent({ ...newAgent, key: e.target.value })}
                      placeholder="opencode-reviewer"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Runtime</Label>
                    <Select
                      value={newAgent.provisionerKey}
                      onValueChange={(provisionerKey: "opencode" | "t3code") =>
                        setNewAgent({ ...newAgent, provisionerKey })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="opencode">OpenCode</SelectItem>
                        <SelectItem value="t3code">T3Code</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description{" "}
                    <span className="text-[12.5px] font-normal text-fg-4">(optional)</span>
                  </Label>
                  <Input
                    id="description"
                    value={newAgent.description}
                    onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
                    placeholder="Shown to users when picking an agent during workspace creation."
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="serverOnly"
                    checked={newAgent.serverOnly}
                    onCheckedChange={(checked) =>
                      setNewAgent({ ...newAgent, serverOnly: checked === true })
                    }
                  />
                  <Label htmlFor="serverOnly" className="text-sm font-normal">
                    Server only (API access, no terminal)
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    createAgentType.mutate({
                      name: newAgent.name,
                      key: newAgent.key,
                      description: newAgent.description.trim() || undefined,
                      provisionerKey: newAgent.provisionerKey,
                      serverOnly: newAgent.serverOnly,
                    })
                  }
                  disabled={!newAgent.name || !newAgent.key || createAgentType.isPending}
                >
                  {createAgentType.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      {isLoading || isImagesLoading ? (
        <Panel>
          {[...Array(3)].map((_, i) => (
            <PanelRow key={i}>
              <Skeleton className="size-9 rounded-lg bg-fill" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40 bg-fill" />
                <Skeleton className="h-3.5 w-72 bg-fill" />
              </div>
            </PanelRow>
          ))}
        </Panel>
      ) : agentTypes?.length === 0 ? (
        <div className="rounded-xl border border-line px-4 py-4 sm:px-5">
          <SettingsEmpty
            icon={<Container />}
            title="No agents yet"
            description="Add one, then connect a runtime image to it."
          />
        </div>
      ) : (
        <Panel>
          {agentTypes?.map((agent) => {
            const runtimeImages = images?.filter((image) => image.agentTypeId === agent.id) ?? [];
            const hasEnabledRuntimeImage = runtimeImages.some((image) => image.isEnabled);
            const isSeeded = ["opencode-ttyd", "opencode", "t3code"].includes(agent.key);

            return (
              <div key={agent.id} className="flex items-start gap-3.5 px-4 py-4 sm:px-5">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill",
                    !agent.isEnabled && "opacity-60",
                  )}
                >
                  <Image
                    src={getIcon(agent.key)}
                    alt=""
                    width={18}
                    height={18}
                    className="size-[18px] object-contain"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <h3
                      className={cn(
                        "text-[14px] font-medium",
                        agent.isEnabled ? "text-fg" : "text-fg-3",
                      )}
                    >
                      {agent.name}
                    </h3>
                    <span className="font-mono text-[12.5px] text-fg-4">{agent.key}</span>
                    {!hasEnabledRuntimeImage ? (
                      <StatusDot tone="warn">No runtime image</StatusDot>
                    ) : agent.isEnabled ? (
                      <StatusDot tone="ok">On</StatusDot>
                    ) : (
                      <StatusDot tone="muted">Off</StatusDot>
                    )}
                    {agent.serverOnly ? (
                      <span className="text-[12.5px] text-fg-4">Server only</span>
                    ) : null}
                  </div>
                  {agent.description ? (
                    <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fg-3">
                      {agent.description}
                    </p>
                  ) : null}

                  {runtimeImages.length > 0 ? (
                    <ul className="mt-3 divide-y divide-line border-t border-line">
                      {runtimeImages.map((runtimeImage) => {
                        const providers = runtimeImage.supportedProviders.map(
                          (provider) => PROVIDER_LABELS[provider] ?? provider,
                        );
                        const scope =
                          providers.length === 1
                            ? `${providers[0]} only`
                            : providers.join(" · ") || "Local only";

                        return (
                          <li
                            key={runtimeImage.id}
                            className="flex min-w-0 flex-col gap-1 py-2.5 last:pb-0 lg:flex-row lg:items-center lg:gap-4"
                          >
                            <Container className="hidden size-3.5 shrink-0 text-fg-4 lg:block" />
                            <div className="min-w-0 lg:w-[22rem] lg:shrink-0">
                              <p className="flex items-baseline gap-2">
                                <span className="truncate text-[13px] font-medium text-fg-2">
                                  {runtimeImage.name}
                                </span>
                                {!runtimeImage.isEnabled ? (
                                  <span className="text-[12.5px] text-fg-4">Off</span>
                                ) : null}
                              </p>
                              <code className="block truncate font-mono text-[12px] text-fg-4">
                                {runtimeImage.imageId}
                              </code>
                            </div>
                            <span className="min-w-0 text-[12.5px] text-fg-3">{scope}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[13px] text-fg-3">
                      Add an image for it under{" "}
                      <Link
                        href={"/admin/images" as Route}
                        className="text-fg-2 underline decoration-line-2 underline-offset-[3px] transition-colors hover:text-fg"
                      >
                        Images
                      </Link>{" "}
                      before turning it on.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!isSeeded ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${agent.name}`}
                      className="size-8 text-fg-3 hover:text-destructive"
                      onClick={() => setDeleteAgentId(agent.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                  <Switch
                    checked={agent.isEnabled}
                    disabled={!hasEnabledRuntimeImage && !agent.isEnabled}
                    onCheckedChange={(checked) =>
                      toggleAgentType.mutate({ id: agent.id, isEnabled: checked })
                    }
                    aria-label={`${agent.isEnabled ? "Disable" : "Enable"} ${agent.name}`}
                  />
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      <Dialog open={!!deleteAgentId} onOpenChange={() => setDeleteAgentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
            <DialogDescription>
              Remove its images first. Built-in agents can&apos;t be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteAgentId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAgentId && deleteAgentType.mutate({ id: deleteAgentId })}
              disabled={deleteAgentType.isPending}
            >
              {deleteAgentType.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

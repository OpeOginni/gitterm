"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
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
import { SettingsEmpty, SettingsGroup } from "@/components/dashboard/settings/settings-page";

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-fill-2 px-2 py-0.5 text-[12.5px] text-fg-3">{children}</span>
  );
}

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
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSessionPending) {
      if (!session?.user) {
        router.push("/login");
        return;
      }
      const userRole = (session.user as any)?.role;
      if (userRole !== "admin") {
        router.push("/dashboard");
        return;
      }
    }
  }, [session?.user, isSessionPending, router]);
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
        heading="Agents"
        text="Manage each workspace agent and the single runtime image that powers it."
      >
        <div className="flex gap-2">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5">
                <Plus className="size-4" />
                Add agent type
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add agent type</DialogTitle>
                <DialogDescription>
                  Create a new agent type that users can deploy.
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
                    placeholder="e.g., OpenCode (TTYD)"
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
                    Server-only mode (no terminal, API access only)
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
                  {createAgentType.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      {isLoading || isImagesLoading ? (
        <div className="space-y-2 rounded-2xl bg-card p-5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full bg-fill" />
          ))}
        </div>
      ) : agentTypes?.length === 0 ? (
        <SettingsGroup>
          <SettingsEmpty
            icon={<Container />}
            title="No agent types configured yet"
            description="Add one to get started."
          />
        </SettingsGroup>
      ) : (
        <div className="divide-y divide-line rounded-2xl bg-card">
          {agentTypes?.map((agent) => {
            const runtimeImages = images?.filter((image) => image.agentTypeId === agent.id) ?? [];
            const hasEnabledRuntimeImage = runtimeImages.some((image) => image.isEnabled);
            const isSeeded = ["opencode-ttyd", "opencode", "t3code"].includes(agent.key);

            return (
              <div
                key={agent.id}
                className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:px-6"
              >
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill ${!agent.isEnabled ? "opacity-60" : ""}`}
                >
                  <Image
                    src={getIcon(agent.key)}
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 object-contain"
                  />
                </div>
                <div className={`min-w-0 flex-1 space-y-3 ${!agent.isEnabled ? "opacity-60" : ""}`}>
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-[15px] font-medium text-fg">{agent.name}</h3>
                      <span className="font-mono text-[12.5px] text-fg-3">{agent.key}</span>
                      {agent.serverOnly ? <Chip>Server only</Chip> : null}
                      {!agent.isEnabled ? <Chip>Disabled</Chip> : null}
                    </div>
                    {agent.description ? (
                      <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-fg-3">
                        {agent.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl bg-fill px-4 py-3">
                    <p className="mb-2 flex items-center gap-2 text-[13px] text-fg-3">
                      <Container
                        className={`size-4 shrink-0 ${runtimeImages.length > 0 ? "text-fg-4" : "text-[#fb923c]"}`}
                      />
                      Runtime images
                      {runtimeImages.length > 0 ? (
                        <span className="tabular-nums text-fg-4">{runtimeImages.length}</span>
                      ) : null}
                    </p>
                    {runtimeImages.length > 0 ? (
                      <div className="divide-y divide-line">
                        {runtimeImages.map((runtimeImage) => {
                          const providers = runtimeImage.supportedProviders.map(
                            (provider) => PROVIDER_LABELS[provider] ?? provider,
                          );
                          const scope =
                            providers.length === 1
                              ? `${providers[0]} only`
                              : providers.join(" · ") || "Local only";

                          return (
                            <div
                              key={runtimeImage.id}
                              className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[14px] font-medium text-fg-2">
                                    {runtimeImage.name}
                                  </span>
                                  {!runtimeImage.isEnabled ? <Chip>Disabled</Chip> : null}
                                </div>
                                <code className="block truncate font-mono text-[12.5px] text-fg-3">
                                  {runtimeImage.imageId}
                                </code>
                              </div>
                              <span className="w-fit shrink-0 text-[13px] text-fg-3">{scope}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="pl-6">
                        <p className="text-[14px] font-medium text-[#fb923c]">
                          Runtime image missing
                        </p>
                        <p className="text-[13px] text-fg-3">
                          Connect an image before enabling this agent.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-2 sm:self-center">
                  <Switch
                    checked={agent.isEnabled}
                    disabled={!hasEnabledRuntimeImage && !agent.isEnabled}
                    onCheckedChange={(checked) =>
                      toggleAgentType.mutate({ id: agent.id, isEnabled: checked })
                    }
                    aria-label={`${agent.isEnabled ? "Disable" : "Enable"} ${agent.name}`}
                  />
                  {!isSeeded ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${agent.name}`}
                      className="size-9 text-fg-3 hover:text-red-400"
                      onClick={() => setDeleteAgentId(agent.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!deleteAgentId} onOpenChange={() => setDeleteAgentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent type</DialogTitle>
            <DialogDescription>
              Custom agent types can only be deleted after their images are removed. Seeded agent
              types cannot be deleted.
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
              {deleteAgentType.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

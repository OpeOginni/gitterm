"use client";

import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import type { Route } from "next";
import { Container, Plus, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

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
          <Button asChild variant="outline">
            <Link
              href={"/admin" as Route}
              className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Back to Admin
            </Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85">
                <Plus className="h-4 w-4 mr-2" />
                Add Agent Type
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Agent Type</DialogTitle>
                <DialogDescription>
                  Create a new agent type that users can deploy.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Agent Name</Label>
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
                    <span className="text-xs font-normal text-muted-foreground">(optional)</span>
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
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
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

      <div className="pt-2 space-y-6">
        {isLoading || isImagesLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {agentTypes?.map((agent) => {
              const runtimeImage = images?.find((image) => image.agentTypeId === agent.id);
              const isSeeded = ["opencode-ttyd", "opencode", "t3code"].includes(agent.key);

              return (
                <div
                  key={agent.id}
                  className={`group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-colors hover:border-amber-400/20 ${!agent.isEnabled ? "opacity-60" : ""}`}
                >
                  <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/[0.04] opacity-0 blur-3xl transition-opacity group-hover:opacity-100" />
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="rounded-xl border border-border bg-foreground/[0.02] p-2.5">
                      <Image
                        src={getIcon(agent.key)}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="font-semibold text-foreground/90">{agent.name}</h3>
                          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            {agent.key}
                          </span>
                          {agent.serverOnly ? (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              Server only
                            </span>
                          ) : null}
                          {!agent.isEnabled ? (
                            <Badge
                              variant="outline"
                              className="border-foreground/[0.08] bg-foreground/[0.04] text-[10px] text-muted-foreground"
                            >
                              Disabled
                            </Badge>
                          ) : null}
                        </div>
                        {agent.description ? (
                          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                            {agent.description}
                          </p>
                        ) : null}
                      </div>

                      <div
                        className={`flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
                          runtimeImage
                            ? "border-border/70 bg-foreground/[0.015]"
                            : "border-amber-500/20 bg-amber-500/[0.04]"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Container
                            className={`h-4 w-4 shrink-0 ${runtimeImage ? "text-muted-foreground" : "text-amber-400"}`}
                          />
                          {runtimeImage ? (
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-foreground/85">
                                  {runtimeImage.name}
                                </span>
                                {!runtimeImage.isEnabled ? (
                                  <Badge
                                    variant="outline"
                                    className="border-foreground/[0.08] text-[10px] text-muted-foreground"
                                  >
                                    Image disabled
                                  </Badge>
                                ) : null}
                              </div>
                              <code className="block truncate font-mono text-[11px] text-muted-foreground">
                                {runtimeImage.imageId}
                              </code>
                            </div>
                          ) : (
                            <div>
                              <p className="text-sm font-medium text-amber-300">
                                Runtime image missing
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Connect an image before enabling this agent.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 sm:self-center">
                      <Switch
                        checked={agent.isEnabled}
                        disabled={!runtimeImage && !agent.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleAgentType.mutate({ id: agent.id, isEnabled: checked })
                        }
                        aria-label={`${agent.isEnabled ? "Disable" : "Enable"} ${agent.name}`}
                      />
                      {!isSeeded ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-white/35 hover:text-red-400"
                          onClick={() => setDeleteAgentId(agent.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}

            {agentTypes?.length === 0 && (
              <div className="py-12 text-center text-white/30">
                No agent types configured yet. Add one to get started.
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!deleteAgentId} onOpenChange={() => setDeleteAgentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent Type</DialogTitle>
            <DialogDescription>
              Custom agent types can only be deleted after their images are removed. Seeded agent
              types cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAgentId(null)}>
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

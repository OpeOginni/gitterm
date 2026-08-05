"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
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
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

const DEFAULT_PROVIDER_METADATA = `{
  "aws": {
    "cpu": 2048,
    "memory": 4096,
    "containerPort": 7681,
    "healthCheckPath": "/"
  },
  "e2b": {
    "templateId": "",
    "sshTemplateId": ""
  },
  "daytona": {
    "image": "",
    "resources": { "cpu": 2, "memory": 4 },
    "editorResources": { "cpu": 4, "memory": 8 }
  },
  "vercel": {
    "image": "my-vcr-repository:latest",
    "vcpus": 2
  },
  "upstash": {
    "runtime": "node",
    "size": "small"
  },
  "ascii": {
    "size": "default"
  },
  "exedev": {
    "image": "exeuntu",
    "cpu": 2,
    "memory": "8GB",
    "disk": "25GB"
  }
}`;

const PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS",
  e2b: "E2B",
  daytona: "Daytona",
  cloudflare: "Cloudflare",
  vercel: "Vercel",
  upstash: "Upstash",
  ascii: "Ascii",
  exedev: "exe.dev",
};

function getSupportedProviders(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const providerMetadata = metadata as Record<string, any>;
  const supported = [
    providerMetadata.aws ? "aws" : null,
    providerMetadata.e2b?.templateId ? "e2b" : null,
    providerMetadata.daytona?.image ? "daytona" : null,
    providerMetadata.cloudflare?.startCommand && providerMetadata.cloudflare?.port
      ? "cloudflare"
      : null,
    providerMetadata.vercel?.image ? "vercel" : null,
    providerMetadata.upstash?.runtime ? "upstash" : null,
    providerMetadata.ascii ? "ascii" : null,
    providerMetadata.exedev?.image ? "exedev" : null,
  ].filter((provider): provider is string => provider !== null);
  return supported.map((provider) => PROVIDER_LABELS[provider] ?? provider);
}

export default function ImagesPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteImageId, setDeleteImageId] = useState<string | null>(null);

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
  const [newImage, setNewImage] = useState({
    name: "",
    imageId: "",
    agentTypeId: "",
    providerMetadataJson: DEFAULT_PROVIDER_METADATA,
  });

  const { data: images, isLoading } = useQuery({
    queryKey: ["admin", "images"],
    queryFn: () => trpcClient.admin.infrastructure.listImages.query(),
  });

  const { data: agentTypes } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
  });
  const assignedAgentTypeIds = new Set(images?.map((image) => image.agentTypeId));
  const availableAgentTypes = agentTypes?.filter((agent) => !assignedAgentTypeIds.has(agent.id));

  const createImage = useMutation({
    mutationFn: (params: {
      name: string;
      imageId: string;
      agentTypeId: string;
      providerMetadata: Record<string, unknown>;
    }) => trpcClient.admin.infrastructure.createImage.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      setIsCreateOpen(false);
      setNewImage({
        name: "",
        imageId: "",
        agentTypeId: "",
        providerMetadataJson: DEFAULT_PROVIDER_METADATA,
      });
      toast.success("Image created");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCreateImage = () => {
    let providerMetadata: Record<string, unknown>;

    try {
      const parsed = JSON.parse(newImage.providerMetadataJson || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        toast.error("Provider metadata must be a JSON object");
        return;
      }
      providerMetadata = parsed;
    } catch {
      toast.error("Provider metadata contains invalid JSON");
      return;
    }

    createImage.mutate({
      name: newImage.name,
      imageId: newImage.imageId,
      agentTypeId: newImage.agentTypeId,
      providerMetadata,
    });
  };

  const toggleImage = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleImage.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "agentTypes"] });
      toast.success(`Image ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteImage = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      trpcClient.admin.infrastructure.deleteImage.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      setDeleteImageId(null);
      toast.success("Image deleted");
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
        heading="Runtime Images"
        text="Manage the single canonical image connected to each workspace agent."
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
              <Button
                disabled={(availableAgentTypes?.length ?? 0) === 0}
                className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Image
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Container Image</DialogTitle>
                <DialogDescription>Register a new Docker image for workspaces.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Image Name</Label>
                  <Input
                    id="name"
                    value={newImage.name}
                    onChange={(e) => setNewImage({ ...newImage, name: e.target.value })}
                    placeholder="e.g., gitterm-opencode"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="imageId">Docker Image</Label>
                  <Input
                    id="imageId"
                    value={newImage.imageId}
                    onChange={(e) => setNewImage({ ...newImage, imageId: e.target.value })}
                    placeholder="e.g., opeoginni/gitterm-opencode:latest"
                  />
                  <p className="text-xs text-white/40">
                    Full Docker image reference including registry and tag
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentType">Agent Type</Label>
                  <Select
                    value={newImage.agentTypeId}
                    onValueChange={(value) => setNewImage({ ...newImage, agentTypeId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an agent type" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgentTypes?.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="providerMetadata">Provider Metadata</Label>
                  <textarea
                    id="providerMetadata"
                    value={newImage.providerMetadataJson}
                    onChange={(e) =>
                      setNewImage({ ...newImage, providerMetadataJson: e.target.value })
                    }
                    className="min-h-52 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    spellCheck={false}
                  />
                  <p className="text-xs text-white/40">
                    Optional provider-specific config such as AWS resources, E2B templates, or
                    Daytona image/resources.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateImage}
                  disabled={
                    !newImage.name ||
                    !newImage.imageId ||
                    !newImage.agentTypeId ||
                    createImage.isPending
                  }
                >
                  {createImage.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      <div className="pt-2 space-y-6">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {images?.map((image) => {
              const isSeeded =
                image.name === "gitterm-opencode" ||
                image.name === "gitterm-opencode-server" ||
                image.name === "gitterm-t3code-server";
              const supportedProviders = getSupportedProviders(image.providerMetadata);

              return (
                <div
                  key={image.id}
                  className={`group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-colors hover:border-amber-400/20 ${!image.isEnabled ? "opacity-60" : ""}`}
                >
                  <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/[0.04] opacity-0 blur-3xl transition-opacity group-hover:opacity-100" />
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="relative rounded-xl border border-border bg-foreground/[0.02] p-2.5">
                      <Image
                        src={getIcon(image.agentType.key)}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="font-semibold text-foreground/90">{image.name}</h3>
                          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {image.agentType.name}
                          </span>
                          {image.agentType.serverOnly ? (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              Server only
                            </span>
                          ) : null}
                          {!image.isEnabled ? (
                            <Badge
                              variant="outline"
                              className="border-foreground/[0.08] bg-foreground/[0.04] text-[10px] text-muted-foreground"
                            >
                              Disabled
                            </Badge>
                          ) : null}
                        </div>
                        <code className="mt-1 block max-w-2xl truncate font-mono text-xs text-muted-foreground">
                          {image.imageId}
                        </code>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          Runs on
                        </span>
                        {supportedProviders.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {supportedProviders.join(" · ")}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-400">
                            No provider compatibility configured
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                      {!isSeeded ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-white/35 hover:text-red-400"
                          onClick={() => setDeleteImageId(image.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Switch
                        checked={image.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleImage.mutate({ id: image.id, isEnabled: checked })
                        }
                        aria-label={`${image.isEnabled ? "Disable" : "Enable"} ${image.name}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {images?.length === 0 && (
              <div className="py-12 text-center text-white/30">
                No images configured yet. Add one to get started.
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!deleteImageId} onOpenChange={() => setDeleteImageId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Image</DialogTitle>
            <DialogDescription>
              This removes the custom image from the admin catalog. Seeded images cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteImageId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteImageId && deleteImage.mutate({ id: deleteImageId })}
              disabled={deleteImage.isPending}
            >
              {deleteImage.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

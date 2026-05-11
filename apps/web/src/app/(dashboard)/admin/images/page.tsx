"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { Plus, Container, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
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
    "snapshot": ""
  }
}`;

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
  }, [session?.user, isSessionPending]);
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
        heading="Container Images"
        text="Manage Docker images used for workspaces. Disabled images won't appear in workspace creation."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
          <Link href={"/admin" as Route} className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">Back to Admin</Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85">
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
                      {agentTypes?.map((agent) => (
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
                    Daytona snapshots.
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
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {images?.map((image) => {
              const isSeeded =
                image.name === "gitterm-opencode" ||
                image.name === "gitterm-opencode-server" ||
                image.name === "gitterm-opencode-aws-server";

              return (
                <div
                  key={image.id}
                  className={`flex items-center justify-between p-4 border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.02] ${!image.isEnabled ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="rounded-xl bg-white/[0.04] p-2.5">
                      <Container className="h-5 w-5 text-white/40" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-white/90">{image.name}</span>
                        {!image.isEnabled && (
                          <Badge
                            variant="outline"
                            className="border-white/[0.08] bg-white/[0.04] text-white/40 text-xs"
                          >
                            Disabled
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs"
                        >
                          {image.agentType.name}
                        </Badge>
                        {image.agentType.serverOnly && (
                          <Badge
                            variant="outline"
                            className="border-white/[0.08] bg-white/[0.04] text-white/40 text-xs"
                          >
                            Server Only
                          </Badge>
                        )}
                      </div>
                      <code className="font-mono text-xs text-white/25 mt-0.5 block truncate max-w-md">
                        {image.imageId}
                      </code>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isSeeded && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white/35 hover:text-red-400"
                        onClick={() => setDeleteImageId(image.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    <Switch
                      checked={image.isEnabled}
                      onCheckedChange={(checked) =>
                        toggleImage.mutate({ id: image.id, isEnabled: checked })
                      }
                    />
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

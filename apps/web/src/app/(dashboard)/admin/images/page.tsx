"use client";

import { useState } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
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
import { Plus, Container } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

export default function ImagesPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newImage, setNewImage] = useState({ name: "", imageId: "", agentTypeId: "" });

  const { data: images, isLoading } = useQuery({
    queryKey: ["admin", "images"],
    queryFn: () => trpcClient.admin.infrastructure.listImages.query(),
  });

  const { data: agentTypes } = useQuery({
    queryKey: ["admin", "agentTypes"],
    queryFn: () => trpcClient.admin.infrastructure.listAgentTypes.query(),
  });

  const createImage = useMutation({
    mutationFn: (params: { name: string; imageId: string; agentTypeId: string }) =>
      trpcClient.admin.infrastructure.createImage.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      setIsCreateOpen(false);
      setNewImage({ name: "", imageId: "", agentTypeId: "" });
      toast.success("Image created");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleImage = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleImage.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      toast.success(`Image ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Container Images"
        text="Manage Docker images used for workspaces. Disabled images won't appear in workspace creation."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin" as Route}>Back to Admin</Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
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
                  <p className="text-xs text-muted-foreground">
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
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createImage.mutate(newImage)}
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

      <div className="pt-8 space-y-6">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {images?.map((image) => (
              <div
                key={image.id}
                className={`flex items-center justify-between py-4 px-4 rounded-lg hover:bg-muted/40 transition-colors group ${!image.isEnabled ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-md bg-muted/50">
                    <Container className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{image.name}</span>
                      {!image.isEnabled && (
                        <Badge variant="secondary" className="text-xs">
                          Disabled
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {image.agentType.name}
                      </Badge>
                      {image.agentType.serverOnly && (
                        <Badge variant="secondary" className="text-xs">
                          Server Only
                        </Badge>
                      )}
                    </div>
                    <code className="text-xs text-muted-foreground mt-0.5 block truncate max-w-md">
                      {image.imageId}
                    </code>
                  </div>
                </div>
                <Switch
                  checked={image.isEnabled}
                  onCheckedChange={(checked) =>
                    toggleImage.mutate({ id: image.id, isEnabled: checked })
                  }
                />
              </div>
            ))}

            {images?.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                No images configured yet. Add one to get started.
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

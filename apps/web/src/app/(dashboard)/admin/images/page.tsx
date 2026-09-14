"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

const PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS",
  e2b: "E2B",
  daytona: "Daytona",
  cloudflare: "Cloudflare",
  vercel: "Vercel",
  ascii: "Ascii",
  exedev: "exe.dev",
  railway: "Railway",
};

const PROVIDER_DEFINITIONS = [
  {
    key: "aws",
    label: "AWS",
    description: "ECS task sizing and health checks.",
    initial: { cpu: 2048, memory: 4096, containerPort: 7681, healthCheckPath: "/" },
  },
  {
    key: "e2b",
    label: "E2B",
    description: "Template IDs built for this agent.",
    initial: { templateId: "", sshTemplateId: "" },
  },
  {
    key: "daytona",
    label: "Daytona",
    description: "Container image and workspace resources.",
    initial: {
      image: "",
      resources: { cpu: 2, memory: 4 },
      editorResources: { cpu: 4, memory: 8 },
    },
  },
  {
    key: "cloudflare",
    label: "Cloudflare",
    description: "Agent start command and listening port.",
    initial: { startCommand: "", port: 7681, setupCommands: [] },
  },
  {
    key: "vercel",
    label: "Vercel",
    description: "Registry image or managed runtime configuration.",
    initial: { image: "", vcpus: 2 },
  },
  {
    key: "ascii",
    label: "Ascii",
    description: "Box size and agent installation commands.",
    initial: { size: "default", setupCommands: [] },
  },
  {
    key: "exedev",
    label: "exe.dev",
    description: "Base image and machine sizing.",
    initial: { image: "exeuntu", cpu: 2, memory: "8GB", disk: "25GB" },
  },
  {
    key: "railway",
    label: "Railway",
    description: "Use this image directly on Railway.",
    initial: {},
  },
] as const;

type ProviderKey = (typeof PROVIDER_DEFINITIONS)[number]["key"];
type ProviderDrafts = Partial<Record<ProviderKey, string>>;

const providerKeySet = new Set<string>(PROVIDER_DEFINITIONS.map((provider) => provider.key));

function metadataToDrafts(metadata: Record<string, unknown>): ProviderDrafts {
  return Object.fromEntries(
    PROVIDER_DEFINITIONS.filter((provider) => provider.key in metadata).map((provider) => [
      provider.key,
      JSON.stringify(metadata[provider.key], null, 2),
    ]),
  );
}

function extraMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !providerKeySet.has(key)));
}

function parseProviderDrafts(
  drafts: ProviderDrafts,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const metadata = { ...extra };
  for (const provider of PROVIDER_DEFINITIONS) {
    const draft = drafts[provider.key];
    if (draft === undefined) continue;
    try {
      const parsed = JSON.parse(draft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      metadata[provider.key] = parsed;
    } catch {
      throw new Error(`${provider.label} metadata must be a JSON object`);
    }
  }
  return metadata;
}

function ProviderMetadataEditor({
  idPrefix,
  drafts,
  onChange,
}: {
  idPrefix: string;
  drafts: ProviderDrafts;
  onChange: (drafts: ProviderDrafts) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Provider availability</Label>
        <p className="mt-1 text-xs leading-relaxed text-fg-4">
          Enable only the providers that should use this image. Provider-specific images take
          precedence over general images.
        </p>
      </div>
      <div className="space-y-2">
        {PROVIDER_DEFINITIONS.map((provider) => {
          const enabled = drafts[provider.key] !== undefined;
          return (
            <div
              key={provider.key}
              className={`rounded-xl border px-3 py-3 transition-colors ${
                enabled ? "border-amber-400/25 bg-amber-400/[0.035]" : "border-border/70"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={`${idPrefix}-${provider.key}`}>{provider.label}</Label>
                  <p className="mt-0.5 text-xs text-fg-4">{provider.description}</p>
                </div>
                <Switch
                  id={`${idPrefix}-${provider.key}`}
                  checked={enabled}
                  onCheckedChange={(checked) => {
                    const next = { ...drafts };
                    if (checked) next[provider.key] = JSON.stringify(provider.initial, null, 2);
                    else delete next[provider.key];
                    onChange(next);
                  }}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${provider.label}`}
                />
              </div>
              {enabled ? (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <Label
                    htmlFor={`${idPrefix}-${provider.key}-metadata`}
                    className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {provider.label} metadata
                  </Label>
                  <Textarea
                    id={`${idPrefix}-${provider.key}-metadata`}
                    value={drafts[provider.key]}
                    onChange={(event) =>
                      onChange({ ...drafts, [provider.key]: event.target.value })
                    }
                    className="mt-2 min-h-28 resize-y font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ImagesPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteImageId, setDeleteImageId] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<{
    id: string;
    name: string;
    providerDrafts: ProviderDrafts;
    extraMetadata: Record<string, unknown>;
  } | null>(null);

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
    providerDrafts: {} as ProviderDrafts,
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
        providerDrafts: {},
      });
      toast.success("Image created");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCreateImage = () => {
    try {
      const providerMetadata = parseProviderDrafts(newImage.providerDrafts);
      if (Object.keys(providerMetadata).length === 0) {
        toast.error("Enable at least one provider");
        return;
      }
      createImage.mutate({
        name: newImage.name,
        imageId: newImage.imageId,
        agentTypeId: newImage.agentTypeId,
        providerMetadata,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provider metadata is invalid");
      return;
    }
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

  const updateImage = useMutation({
    mutationFn: (params: { id: string; providerMetadata: Record<string, unknown> }) =>
      trpcClient.admin.infrastructure.updateImage.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
      setEditingImage(null);
      toast.success("Provider metadata updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleUpdateImage = () => {
    if (!editingImage) return;

    try {
      const providerMetadata = parseProviderDrafts(
        editingImage.providerDrafts,
        editingImage.extraMetadata,
      );
      if (Object.keys(editingImage.providerDrafts).length === 0) {
        toast.error("Enable at least one provider");
        return;
      }
      updateImage.mutate({ id: editingImage.id, providerMetadata });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provider metadata is invalid");
    }
  };

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
        text="Manage the runtime images for each workspace agent. When several images support a provider, the most provider-specific image runs there."
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
                disabled={(agentTypes?.length ?? 0) === 0}
                className="bg-primary font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/85"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Image
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
                  <p className="text-xs text-fg-4">
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
                <ProviderMetadataEditor
                  idPrefix="create-provider"
                  drafts={newImage.providerDrafts}
                  onChange={(providerDrafts) =>
                    setNewImage((current) => ({ ...current, providerDrafts }))
                  }
                />
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
              const supportedProviders = image.supportedProviders.map(
                (provider) => PROVIDER_LABELS[provider] ?? provider,
              );

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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-fg-4 hover:text-amber-300"
                        onClick={() =>
                          setEditingImage({
                            id: image.id,
                            name: image.name,
                            providerDrafts: metadataToDrafts(image.providerMetadata ?? {}),
                            extraMetadata: extraMetadata(image.providerMetadata ?? {}),
                          })
                        }
                        aria-label={`Edit provider metadata for ${image.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!isSeeded ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-fg-4 hover:text-red-400"
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
              <div className="py-12 text-center text-fg-4">
                No images configured yet. Add one to get started.
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!editingImage} onOpenChange={(open) => !open && setEditingImage(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Provider Metadata</DialogTitle>
            <DialogDescription>
              Configure where {editingImage?.name} can run. Saving replaces its complete provider
              mapping.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ProviderMetadataEditor
              idPrefix="edit-provider"
              drafts={editingImage?.providerDrafts ?? {}}
              onChange={(providerDrafts) =>
                setEditingImage((current) => (current ? { ...current, providerDrafts } : current))
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingImage(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateImage} disabled={updateImage.isPending}>
              {updateImage.isPending ? "Saving..." : "Save Metadata"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

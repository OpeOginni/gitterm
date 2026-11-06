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
import { SettingsGroup, settingsLabel } from "@/components/dashboard/settings/settings-page";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
    key: "boat",
    label: "Boat",
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
        <Label className={settingsLabel}>Provider availability</Label>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
          Enable only the providers that should use this image. Provider-specific images take
          precedence over general images.
        </p>
      </div>
      <div className="divide-y divide-line rounded-xl bg-fill px-4">
        {PROVIDER_DEFINITIONS.map((provider) => {
          const enabled = drafts[provider.key] !== undefined;
          return (
            <div key={provider.key} className="py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label
                    htmlFor={`${idPrefix}-${provider.key}`}
                    className="text-[14px] font-medium text-fg"
                  >
                    {provider.label}
                  </Label>
                  <p className="mt-0.5 text-[13px] text-fg-3">{provider.description}</p>
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
                <div className="mt-3">
                  <Label htmlFor={`${idPrefix}-${provider.key}-metadata`} className={settingsLabel}>
                    {provider.label} metadata
                  </Label>
                  <Textarea
                    id={`${idPrefix}-${provider.key}-metadata`}
                    value={drafts[provider.key]}
                    onChange={(event) =>
                      onChange({ ...drafts, [provider.key]: event.target.value })
                    }
                    className="mt-2 min-h-28 resize-y font-mono text-[13px]"
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
        heading="Runtime images"
        text="Manage the runtime images for each workspace agent. When several images support a provider, the most provider-specific image runs there."
      >
        <div className="flex gap-2">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button disabled={(agentTypes?.length ?? 0) === 0}>
                <Plus className="h-4 w-4" />
                Add image
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add container image</DialogTitle>
                <DialogDescription>Register a new Docker image for workspaces.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className={settingsLabel}>
                    Image name
                  </Label>
                  <Input
                    id="name"
                    value={newImage.name}
                    onChange={(e) => setNewImage({ ...newImage, name: e.target.value })}
                    placeholder="e.g., gitterm-opencode"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="imageId" className={settingsLabel}>
                    Docker image
                  </Label>
                  <Input
                    id="imageId"
                    value={newImage.imageId}
                    onChange={(e) => setNewImage({ ...newImage, imageId: e.target.value })}
                    placeholder="e.g., opeoginni/gitterm-opencode:latest"
                  />
                  <p className="text-[13px] text-fg-3">
                    Full Docker image reference including registry and tag
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentType" className={settingsLabel}>
                    Agent type
                  </Label>
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
                <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
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

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full bg-fill" />
          ))}
        </div>
      ) : (
        <SettingsGroup
          title={
            images?.length
              ? `${images.length} ${images.length === 1 ? "image" : "images"}`
              : "Images"
          }
          bodyClassName="pt-2"
        >
          {images?.length === 0 ? (
            <p className="py-6 text-[14px] text-fg-3">
              No images configured yet. Add one to get started.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {images?.map((image) => {
                const isSeeded =
                  image.name === "gitterm-opencode" ||
                  image.name === "gitterm-opencode-server" ||
                  image.name === "gitterm-t3code-server";
                const supportedProviders = image.supportedProviders.map(
                  (provider) => PROVIDER_LABELS[provider] ?? provider,
                );

                return (
                  <li
                    key={image.id}
                    className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4 ${!image.isEnabled ? "opacity-60" : ""}`}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill">
                      <Image
                        src={getIcon(image.agentType.key)}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                      />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <h3 className="text-[14.5px] font-medium text-fg">{image.name}</h3>
                        <span className="text-[13px] text-fg-3">{image.agentType.name}</span>
                        {image.agentType.serverOnly ? (
                          <span className="rounded-full bg-fill-2 px-2 py-0.5 text-[12.5px] text-fg-3">
                            Server only
                          </span>
                        ) : null}
                        {!image.isEnabled ? (
                          <span className="rounded-full bg-fill-2 px-2 py-0.5 text-[12.5px] text-fg-3">
                            Disabled
                          </span>
                        ) : null}
                      </div>
                      <code className="block max-w-2xl truncate font-mono text-[12.5px] text-fg-3">
                        {image.imageId}
                      </code>
                      <p className="text-[13px] text-fg-3">
                        {supportedProviders.length > 0 ? (
                          <>Runs on {supportedProviders.join(" · ")}</>
                        ) : (
                          <span className="text-[#fb923c]">
                            No provider compatibility configured
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-fg-3 hover:text-fg"
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
                          className="h-9 w-9 text-fg-3 hover:text-destructive"
                          onClick={() => setDeleteImageId(image.id)}
                          aria-label={`Delete ${image.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Switch
                        className="ml-1.5"
                        checked={image.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleImage.mutate({ id: image.id, isEnabled: checked })
                        }
                        aria-label={`${image.isEnabled ? "Disable" : "Enable"} ${image.name}`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsGroup>
      )}

      <Dialog open={!!editingImage} onOpenChange={(open) => !open && setEditingImage(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit provider metadata</DialogTitle>
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
            <Button variant="secondary" onClick={() => setEditingImage(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateImage} disabled={updateImage.isPending}>
              {updateImage.isPending ? "Saving..." : "Save metadata"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteImageId} onOpenChange={() => setDeleteImageId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete image</DialogTitle>
            <DialogDescription>
              This removes the custom image from the admin catalog. Seeded images cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteImageId(null)}>
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

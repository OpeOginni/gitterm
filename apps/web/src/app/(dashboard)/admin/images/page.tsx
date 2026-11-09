"use client";

import { useState } from "react";
import Image from "next/image";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow, StatusDot } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { useAdminGuard } from "../_components/admin";
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
import { SettingsEmpty, settingsLabel } from "@/components/dashboard/settings/settings-page";
import { Container, Pencil, Plus, Trash2 } from "lucide-react";
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
      <div className="divide-y divide-line rounded-xl border border-line px-4">
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
  const { ready } = useAdminGuard();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteImageId, setDeleteImageId] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<{
    id: string;
    name: string;
    providerDrafts: ProviderDrafts;
    extraMetadata: Record<string, unknown>;
  } | null>(null);

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
        heading="Runtime images"
        text="The container images agents run in. Where several fit a provider, the most specific one runs."
      >
        <div className="flex self-start">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button disabled={(agentTypes?.length ?? 0) === 0}>
                <Plus className="size-4" />
                Add image
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add image</DialogTitle>
                <DialogDescription>A Docker image an agent runs in.</DialogDescription>
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
                    placeholder="gitterm-opencode"
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
                    placeholder="opeoginni/gitterm-opencode:latest"
                    className="font-mono text-[13px]"
                  />
                  <p className="text-[13px] text-fg-3">
                    The full reference, with registry and tag.
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
                  {createImage.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      {isLoading ? (
        <Panel>
          {[...Array(3)].map((_, i) => (
            <PanelRow key={i}>
              <Skeleton className="size-9 rounded-lg bg-fill" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-48 bg-fill" />
                <Skeleton className="h-3.5 w-64 bg-fill" />
              </div>
            </PanelRow>
          ))}
        </Panel>
      ) : images?.length === 0 ? (
        <div className="rounded-xl border border-line px-4 py-4 sm:px-5">
          <SettingsEmpty
            icon={<Container />}
            title="No images yet"
            description="Add one so an agent can start."
          />
        </div>
      ) : (
        <Panel className="max-h-[75vh] overflow-y-auto">
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
                className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3.5 sm:flex-nowrap sm:px-5"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill",
                    !image.isEnabled && "opacity-60",
                  )}
                >
                  <Image
                    src={getIcon(image.agentType.key)}
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
                        image.isEnabled ? "text-fg" : "text-fg-3",
                      )}
                    >
                      {image.name}
                    </h3>
                    <span className="text-[12.5px] text-fg-3">
                      {image.agentType.name}
                      {image.agentType.serverOnly ? ", server only" : ""}
                    </span>
                    {!image.isEnabled ? <StatusDot tone="muted">Off</StatusDot> : null}
                  </div>
                  <code className="mt-0.5 block truncate font-mono text-[12px] text-fg-4">
                    {image.imageId}
                  </code>
                  <p className="mt-0.5 text-[12.5px] text-fg-3">
                    {supportedProviders.length > 0 ? (
                      <>Runs on {supportedProviders.join(" · ")}</>
                    ) : (
                      <span className="text-[#fb923c]">No provider set, so it never runs</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-1 max-sm:basis-full">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-fg-3"
                    onClick={() =>
                      setEditingImage({
                        id: image.id,
                        name: image.name,
                        providerDrafts: metadataToDrafts(image.providerMetadata ?? {}),
                        extraMetadata: extraMetadata(image.providerMetadata ?? {}),
                      })
                    }
                    aria-label={`Edit providers for ${image.name}`}
                  >
                    <Pencil className="size-3.5" />
                    Providers
                  </Button>
                  {!isSeeded ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-fg-3 hover:text-destructive"
                      onClick={() => setDeleteImageId(image.id)}
                      aria-label={`Delete ${image.name}`}
                    >
                      <Trash2 className="size-4" />
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
              </div>
            );
          })}
        </Panel>
      )}

      <Dialog open={!!editingImage} onOpenChange={(open) => !open && setEditingImage(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Providers for {editingImage?.name}</DialogTitle>
            <DialogDescription>Where it can run. Saving replaces the whole list.</DialogDescription>
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
              {updateImage.isPending ? "Saving…" : "Save providers"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteImageId} onOpenChange={() => setDeleteImageId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete image</DialogTitle>
            <DialogDescription>
              It leaves the catalog for good. Built-in images can&apos;t be deleted.
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
              {deleteImage.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

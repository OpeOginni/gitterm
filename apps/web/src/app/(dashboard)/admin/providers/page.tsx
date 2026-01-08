"use client";

import { useState } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Globe, MapPin } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

export default function ProvidersPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreateRegionOpen, setIsCreateRegionOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [newProviderName, setNewProviderName] = useState("");
  const [newRegion, setNewRegion] = useState({
    name: "",
    location: "",
    externalRegionIdentifier: "",
  });

  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => trpcClient.admin.infrastructure.listProviders.query(),
  });

  const createProvider = useMutation({
    mutationFn: (name: string) => trpcClient.admin.infrastructure.createProvider.mutate({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      setIsCreateOpen(false);
      setNewProviderName("");
      toast.success("Provider created");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleProvider = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleProvider.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      toast.success(`Provider ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const createRegion = useMutation({
    mutationFn: (params: {
      cloudProviderId: string;
      name: string;
      location: string;
      externalRegionIdentifier: string;
    }) => trpcClient.admin.infrastructure.createRegion.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      setIsCreateRegionOpen(false);
      setSelectedProviderId(null);
      setNewRegion({ name: "", location: "", externalRegionIdentifier: "" });
      toast.success("Region created");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleRegion = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      trpcClient.admin.infrastructure.toggleRegion.mutate({ id, isEnabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      toast.success(`Region ${data.isEnabled ? "enabled" : "disabled"}`);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Cloud Providers"
        text="Manage cloud providers and their regions. Disabled items won't appear in workspace creation."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin" as Route}>Back to Admin</Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Cloud Provider</DialogTitle>
                <DialogDescription>
                  Create a new cloud provider (e.g., Railway, AWS, Local).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Provider Name</Label>
                  <Input
                    id="name"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder="e.g., Railway"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createProvider.mutate(newProviderName)}
                  disabled={!newProviderName || createProvider.isPending}
                >
                  {createProvider.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      <div className="pt-8 space-y-8">
        {isLoading ? (
          <div className="space-y-6">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {providers?.map((provider) => (
              <div key={provider.id} className={!provider.isEnabled ? "opacity-60" : ""}>
                {/* Provider Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{provider.name}</h3>
                      {!provider.isEnabled && (
                        <Badge variant="secondary" className="text-xs">
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {provider.regions.filter((r) => r.isEnabled).length} of{" "}
                      {provider.regions.length} region{provider.regions.length !== 1 ? "s" : ""}{" "}
                      enabled
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedProviderId(provider.id);
                        setIsCreateRegionOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Region
                    </Button>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`provider-${provider.id}`}
                        className="text-sm text-muted-foreground"
                      >
                        {provider.isEnabled ? "Enabled" : "Disabled"}
                      </Label>
                      <Switch
                        id={`provider-${provider.id}`}
                        checked={provider.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleProvider.mutate({ id: provider.id, isEnabled: checked })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Regions List */}
                {provider.regions.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-8">No regions configured yet.</p>
                ) : (
                  <div className="space-y-1 pl-8">
                    {provider.regions.map((region) => (
                      <div
                        key={region.id}
                        className={`flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted/40 transition-colors group ${!region.isEnabled ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{region.name}</span>
                            {!region.isEnabled && (
                              <Badge variant="secondary" className="text-xs">
                                Disabled
                              </Badge>
                            )}
                            <span className="text-muted-foreground">-</span>
                            <span className="text-sm text-muted-foreground">{region.location}</span>
                            <code className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded">
                              {region.externalRegionIdentifier}
                            </code>
                          </div>
                        </div>
                        <Switch
                          checked={region.isEnabled}
                          onCheckedChange={(checked) =>
                            toggleRegion.mutate({ id: region.id, isEnabled: checked })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Divider between providers */}
                <div className="mt-6 border-b border-border/30" />
              </div>
            ))}

            {providers?.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                No cloud providers configured yet. Run the seed script to add defaults.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Region Dialog */}
      <Dialog open={isCreateRegionOpen} onOpenChange={setIsCreateRegionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Region</DialogTitle>
            <DialogDescription>Add a new region to this cloud provider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="region-name">Region Name</Label>
              <Input
                id="region-name"
                value={newRegion.name}
                onChange={(e) => setNewRegion({ ...newRegion, name: e.target.value })}
                placeholder="e.g., US West"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={newRegion.location}
                onChange={(e) => setNewRegion({ ...newRegion, location: e.target.value })}
                placeholder="e.g., California"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="external-id">External Identifier</Label>
              <Input
                id="external-id"
                value={newRegion.externalRegionIdentifier}
                onChange={(e) =>
                  setNewRegion({ ...newRegion, externalRegionIdentifier: e.target.value })
                }
                placeholder="e.g., us-west-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateRegionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                selectedProviderId &&
                createRegion.mutate({
                  cloudProviderId: selectedProviderId,
                  ...newRegion,
                })
              }
              disabled={
                !newRegion.name ||
                !newRegion.location ||
                !newRegion.externalRegionIdentifier ||
                createRegion.isPending
              }
            >
              {createRegion.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

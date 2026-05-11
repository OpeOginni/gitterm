"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
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
import { Plus, KeyRound } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { getIcon } from "@/components/dashboard/create-instance";
import Image from "next/image";

import { AwsProviderSection } from "./_components/aws-provider-section";
import type { ProviderRow } from "./_components/types";

function ProviderRowSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-xl bg-foreground/[0.08]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-28 rounded-md bg-foreground/[0.08]" />
            <Skeleton className="h-4 w-16 rounded-md bg-foreground/[0.06]" />
            <Skeleton className="h-5 w-24 rounded-full bg-foreground/[0.07]" />
          </div>
          <Skeleton className="h-4 w-36 rounded-md bg-foreground/[0.06]" />
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <Skeleton className="h-4 w-4 rounded-full bg-foreground/[0.06]" />
          <Skeleton className="h-4 w-16 rounded-md bg-foreground/[0.06]" />
        </div>
      </div>
    </div>
  );
}

function AwsProviderSectionSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-amber-500/15 bg-card">
      <div className="flex items-center gap-4 p-5">
        <Skeleton className="h-10 w-10 rounded-xl bg-foreground/[0.08]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-12 rounded-md bg-foreground/[0.08]" />
            <Skeleton className="h-4 w-24 rounded-md bg-foreground/[0.06]" />
            <Skeleton className="h-5 w-24 rounded-full bg-amber-500/15" />
          </div>
          <Skeleton className="h-4 w-[18rem] rounded-md bg-foreground/[0.06]" />
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <Skeleton className="h-4 w-16 rounded-md bg-foreground/[0.06]" />
          <Skeleton className="h-4 w-4 rounded-full bg-foreground/[0.06]" />
        </div>
      </div>

      <div className="border-t border-border/60 bg-foreground/[0.015] p-4">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-[34px] w-[34px] rounded-lg bg-foreground/[0.08]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-24 rounded-md bg-foreground/[0.08]" />
                  <Skeleton className="h-3 w-28 rounded-md bg-foreground/[0.06]" />
                  <Skeleton className="h-3 w-20 rounded-md bg-foreground/[0.06]" />
                </div>
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-dashed border-border bg-transparent p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-[34px] w-[34px] rounded-lg bg-foreground/[0.06]" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24 rounded-md bg-foreground/[0.08]" />
                <Skeleton className="h-3 w-20 rounded-md bg-foreground/[0.06]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvidersPageSkeleton() {
  return (
    <div className="space-y-3">
      <AwsProviderSectionSkeleton />
      {[...Array(3)].map((_, i) => (
        <ProviderRowSkeleton key={i} />
      ))}
    </div>
  );
}

export default function ProvidersPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => trpcClient.admin.infrastructure.listProviders.query(),
  });

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

  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [newProviderSupportsRegions, setNewProviderSupportsRegions] = useState(true);

  const createProvider = useMutation({
    mutationFn: (params: { name: string; providerKey: string; supportsRegions: boolean }) =>
      trpcClient.admin.infrastructure.createProvider.mutate(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      setIsCreateOpen(false);
      setNewProviderName("");
      setNewProviderKey("");
      setNewProviderSupportsRegions(true);
      toast.success("Provider created");
    },
    onError: (error) => toast.error(error.message),
  });

  // Group providers by providerKey, treating AWS as a region-cluster.
  const groupedProviders = useMemo(() => {
    if (!providers) {
      return { awsProviders: [] as ProviderRow[], others: [] as ProviderRow[] };
    }
    const awsProviders: ProviderRow[] = [];
    const others: ProviderRow[] = [];
    for (const provider of providers as unknown as ProviderRow[]) {
      if (provider.providerKey === "aws") {
        awsProviders.push(provider);
      } else {
        others.push(provider);
      }
    }
    return { awsProviders, others };
  }, [providers]);

  if (isSessionPending || !session?.user || (session.user as any)?.role !== "admin") {
    return (
      <DashboardShell>
        <DashboardHeader
          heading="Cloud Providers"
          text="Manage cloud providers, regions, and credentials. Each AWS region is its own provider."
        >
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28 rounded-xl bg-foreground/[0.08]" />
            <Skeleton className="h-10 w-32 rounded-xl bg-foreground/[0.08]" />
          </div>
        </DashboardHeader>
        <div className="pt-2">
          <ProvidersPageSkeleton />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Cloud Providers"
        text="Manage cloud providers, regions, and credentials. Each AWS region is its own provider."
      >
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={"/admin" as Route} className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">Back to Admin</Link>
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="font-mono text-xs font-bold uppercase tracking-wider"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Cloud Provider</DialogTitle>
                <DialogDescription>
                  Register a new cloud provider (e.g., Railway, custom). For AWS regions, use the
                  dedicated AWS button instead.
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
                <div className="space-y-2">
                  <Label htmlFor="provider-key">Implementation Key</Label>
                  <Input
                    id="provider-key"
                    value={newProviderKey}
                    onChange={(e) =>
                      setNewProviderKey(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                      )
                    }
                    placeholder="e.g., railway"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maps the provider row to a compute implementation. Use{" "}
                    <span className="font-mono text-foreground">aws</span>,{" "}
                    <span className="font-mono text-foreground">railway</span>,{" "}
                    <span className="font-mono text-foreground">e2b</span>,{" "}
                    <span className="font-mono text-foreground">daytona</span>, or{" "}
                    <span className="font-mono text-foreground">cloudflare</span>.
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-white/[0.02] px-3 py-2">
                  <div>
                    <Label htmlFor="supports-regions">Supports Regions</Label>
                    <p className="text-xs text-white/40">
                      Disable for providers that do not expose region selection.
                    </p>
                  </div>
                  <Switch
                    id="supports-regions"
                    checked={newProviderSupportsRegions}
                    onCheckedChange={setNewProviderSupportsRegions}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    createProvider.mutate({
                      name: newProviderName,
                      providerKey: newProviderKey,
                      supportsRegions: newProviderSupportsRegions,
                    })
                  }
                  disabled={!newProviderName || !newProviderKey || createProvider.isPending}
                >
                  {createProvider.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      <div className="pt-2">
        {isLoading ? (
          <ProvidersPageSkeleton />
        ) : (
          <ul className="space-y-2">
            {/* AWS — expandable cluster row */}
            <li>
              <AwsProviderSection awsProviders={groupedProviders.awsProviders} />
            </li>

            {/* Other providers — flat rows */}
            {groupedProviders.others.map((provider) => (
              <li key={provider.id}>
                <Link
                  href={`/admin/providers/${provider.id}` as Route}
                  className="group relative block overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:border-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/[0.05] opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="flex items-center gap-4">
                    <div className="rounded-xl border border-border bg-foreground/[0.02] p-2.5">
                      <Image
                        src={getIcon(provider.name)}
                        alt={provider.name}
                        height={20}
                        width={20}
                        className="h-5 w-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground/90">{provider.name}</h3>
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                          {provider.providerKey}
                        </span>
                        {!provider.providerConfig ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/20 bg-amber-500/10 text-amber-400 text-[10px]"
                          >
                            Missing Config
                          </Badge>
                        ) : provider.providerConfig.isEnabled ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-[10px]"
                          >
                            Configured
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-[10px]"
                          >
                            Config Disabled
                          </Badge>
                        )}
                        {!provider.isEnabled && (
                          <Badge
                            variant="outline"
                            className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-[10px]"
                          >
                            Disabled
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {provider.supportsRegions
                          ? `${provider.regions.length} region${provider.regions.length !== 1 ? "s" : ""}`
                          : "Regions not supported"}
                      </p>
                    </div>
                    <div className="hidden items-center gap-2 text-xs text-muted-foreground transition-colors group-hover:text-foreground/70 sm:flex">
                      <KeyRound className="h-3.5 w-3.5" />
                      <span className="font-mono uppercase tracking-[0.18em]">Settings</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}

            {(providers?.length ?? 0) === 0 && (
              <li className="py-12 text-center text-sm text-muted-foreground">
                No cloud providers configured yet. Run the seed script to add defaults.
              </li>
            )}
          </ul>
        )}
      </div>

    </DashboardShell>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { ChevronRight, KeyRound, Plus } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import type { ProviderKey } from "@gitterm/schema";
import { getIcon } from "@/components/dashboard/create-instance";
import Image from "next/image";

import { AwsProviderSection } from "./_components/aws-provider-section";
import { StatusChip } from "./_components/status-chip";
import type { ProviderRow } from "./_components/types";

function ProviderRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <Skeleton className="size-10 rounded-xl bg-fill-2" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-5 w-40 rounded-md bg-fill-2" />
        <Skeleton className="h-4 w-28 rounded-md bg-fill" />
      </div>
    </div>
  );
}

function ProvidersPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card">
        <ProviderRowSkeleton />
      </div>
      <div className="divide-y divide-line rounded-2xl bg-card">
        {[...Array(3)].map((_, i) => (
          <ProviderRowSkeleton key={i} />
        ))}
      </div>
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
  }, [session?.user, isSessionPending, router]);

  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [newProviderSupportsRegions, setNewProviderSupportsRegions] = useState(true);

  const createProvider = useMutation({
    mutationFn: (params: { name: string; providerKey: ProviderKey; supportsRegions: boolean }) =>
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
    others.sort((a, b) => {
      const configurationOrder =
        Number(Boolean(b.providerConfig?.isEnabled)) - Number(Boolean(a.providerConfig?.isEnabled));
      return configurationOrder || a.name.localeCompare(b.name);
    });
    return { awsProviders, others };
  }, [providers]);

  const awsIsConfigured = groupedProviders.awsProviders.some(
    (provider) => provider.providerConfig?.isEnabled,
  );

  if (isSessionPending || !session?.user || (session.user as any)?.role !== "admin") {
    return (
      <DashboardShell>
        <DashboardHeader
          heading="Cloud providers"
          text="Manage cloud providers, regions, and credentials. Each AWS region is its own provider."
        >
          <Skeleton className="h-10 w-32 rounded-lg bg-fill-2" />
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
        heading="Cloud providers"
        text="Manage cloud providers, regions, and credentials. Each AWS region is its own provider."
      >
        <div className="flex gap-2">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                Add provider
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add cloud provider</DialogTitle>
                <DialogDescription>
                  Register a new cloud provider (e.g., Railway, custom). For AWS regions, use the
                  dedicated AWS button instead.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Provider name</Label>
                  <Input
                    id="name"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder="e.g., Railway"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider-key">Implementation key</Label>
                  <Input
                    id="provider-key"
                    value={newProviderKey}
                    onChange={(e) =>
                      setNewProviderKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                    }
                    placeholder="e.g., railway"
                    className="font-mono text-[13px]"
                  />
                  <p className="text-[13px] leading-relaxed text-fg-3">
                    Maps the provider row to a compute implementation. Use{" "}
                    <span className="font-mono text-fg-2">aws</span>,{" "}
                    <span className="font-mono text-fg-2">railway</span>,{" "}
                    <span className="font-mono text-fg-2">e2b</span>,{" "}
                    <span className="font-mono text-fg-2">daytona</span>, or{" "}
                    <span className="font-mono text-fg-2">vercel</span>, or{" "}
                    <span className="font-mono text-fg-2">boat</span>, or{" "}
                    <span className="font-mono text-fg-2">exedev</span>, or{" "}
                    <span className="font-mono text-fg-2">cloudflare</span>.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-fill px-4 py-3">
                  <div>
                    <Label htmlFor="supports-regions">Supports regions</Label>
                    <p className="mt-0.5 text-[13px] text-fg-3">
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
                <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    createProvider.mutate({
                      name: newProviderName,
                      providerKey: newProviderKey as ProviderKey,
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

      {isLoading ? (
        <ProvidersPageSkeleton />
      ) : (
        <div className="space-y-6">
          {/* Keep the AWS region group with providers sharing its configuration state. */}
          {awsIsConfigured && <AwsProviderSection awsProviders={groupedProviders.awsProviders} />}

          {groupedProviders.others.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card">
              {groupedProviders.others.map((provider) => (
                <li key={provider.id}>
                  <Link
                    href={`/admin/providers/${provider.id}` as Route}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill">
                      <Image
                        src={getIcon(provider.name)}
                        alt={provider.name}
                        height={20}
                        width={20}
                        className="size-5"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <h3 className="text-[15px] font-medium text-fg">{provider.name}</h3>
                        <span className="font-mono text-[12.5px] text-fg-4">
                          {provider.providerKey}
                        </span>
                        {!provider.providerConfig ? (
                          <StatusChip tone="warn">Missing config</StatusChip>
                        ) : provider.providerConfig.isEnabled ? (
                          <StatusChip tone="ok">Configured</StatusChip>
                        ) : (
                          <StatusChip>Config disabled</StatusChip>
                        )}
                        {!provider.isEnabled && <StatusChip>Disabled</StatusChip>}
                      </div>
                      <p className="mt-1 text-[13px] text-fg-3">
                        {provider.supportsRegions
                          ? `${provider.regions.length} region${provider.regions.length !== 1 ? "s" : ""}`
                          : "Regions not supported"}
                      </p>
                    </div>
                    <span className="hidden items-center gap-1.5 text-[13px] text-fg-3 transition-colors group-hover:text-fg sm:flex">
                      <KeyRound className="size-3.5" />
                      Settings
                      <ChevronRight className="size-3.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {!awsIsConfigured && <AwsProviderSection awsProviders={groupedProviders.awsProviders} />}

          {(providers?.length ?? 0) === 0 && (
            <p className="py-12 text-center text-[14px] text-fg-3">
              No cloud providers configured yet. Run the seed script to add defaults.
            </p>
          )}
        </div>
      )}
    </DashboardShell>
  );
}

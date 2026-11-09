"use client";

import { useState, useMemo } from "react";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Panel, PanelRow, SectionHeading, StatusDot } from "@/components/dashboard/kit";
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
import { ChevronRight, Plus } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import type { ProviderKey } from "@gitterm/schema";
import { getIcon } from "@/components/dashboard/create-instance";
import Image from "next/image";

import { providerStatus, useAdminGuard } from "../_components/admin";
import { AwsProviderSection } from "./_components/aws-provider-section";
import type { ProviderRow } from "./_components/types";

const PROVIDER_KEYS = [
  "aws",
  "railway",
  "e2b",
  "daytona",
  "vercel",
  "boat",
  "exedev",
  "cloudflare",
];

const GROUPS = [
  { state: "setup", title: "Needs setup", description: "Enabled, but workspaces can't start yet." },
  { state: "ready", title: "Ready", description: "Users can start workspaces here." },
  { state: "off", title: "Off", description: "Hidden from users." },
] as const;

/** One group as it loads. Which groups show depends on the data, so its heading is a placeholder. */
function ProvidersSkeleton() {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-8">
        <Skeleton className="h-7 w-36 bg-fill-2" />
        <Skeleton className="h-3.5 w-56 max-w-[40%] bg-fill-2" />
      </div>
      <Panel>
        {[...Array(4)].map((_, i) => (
          <PanelRow key={i}>
            <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-36 bg-fill-2" />
              <Skeleton className="h-3.5 w-24 bg-fill-2" />
            </div>
            <Skeleton className="h-4 w-24 shrink-0 bg-fill-2" />
          </PanelRow>
        ))}
      </Panel>
    </section>
  );
}

function ProviderLink({ provider }: { provider: ProviderRow }) {
  const status = providerStatus(provider);
  const regions = provider.supportsRegions
    ? `${provider.regions.length} region${provider.regions.length === 1 ? "" : "s"}`
    : null;
  const credentials = status.state === "off" && !provider.providerConfig ? "No credentials" : null;
  const meta = [regions, credentials].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/admin/providers/${provider.id}` as Route}
      className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none sm:px-5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
        <Image
          src={getIcon(provider.name)}
          alt=""
          height={18}
          width={18}
          className="size-[18px] object-contain"
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{provider.name}</span>
          <span className="shrink-0 font-mono text-[12.5px] text-fg-4">{provider.providerKey}</span>
        </p>
        {meta ? <p className="mt-0.5 text-[13px] text-fg-3">{meta}</p> : null}
      </div>
      <StatusDot tone={status.tone} className="shrink-0">
        {status.label}
      </StatusDot>
      <ChevronRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
    </Link>
  );
}

export default function ProvidersPage() {
  const { ready } = useAdminGuard();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => trpcClient.admin.infrastructure.listProviders.query(),
    enabled: ready,
  });

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

  // AWS is one provider per region, so it gets its own section.
  const { awsProviders, groups } = useMemo(() => {
    const rows = (providers ?? []) as unknown as ProviderRow[];
    const others = rows
      .filter((provider) => provider.providerKey !== "aws")
      .toSorted((a, b) => a.name.localeCompare(b.name));
    return {
      awsProviders: rows.filter((provider) => provider.providerKey === "aws"),
      groups: GROUPS.map((group) => ({
        ...group,
        providers: others.filter((provider) => providerStatus(provider).state === group.state),
      })).filter((group) => group.providers.length > 0),
    };
  }, [providers]);

  const addButton = (
    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
      <DialogTrigger asChild>
        <Button className="self-start" disabled={!ready}>
          <Plus className="size-4" />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add cloud provider</DialogTitle>
          <DialogDescription>
            Register another provider. For AWS, add a region in the AWS section instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={newProviderName}
              onChange={(e) => setNewProviderName(e.target.value)}
              placeholder="Railway"
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
              placeholder="railway"
              className="font-mono text-[13px]"
            />
            <p className="text-[13px] leading-relaxed text-fg-3">
              Picks the compute implementation. One of{" "}
              {PROVIDER_KEYS.map((key, index) => (
                <span key={key}>
                  <span className="font-mono text-fg-2">{key}</span>
                  {index < PROVIDER_KEYS.length - 1 ? ", " : "."}
                </span>
              ))}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-fill px-4 py-3">
            <div>
              <Label htmlFor="supports-regions">Supports regions</Label>
              <p className="mt-0.5 text-[13px] text-fg-3">
                Turn off if the provider has no region choice.
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
            {createProvider.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Cloud providers"
        text="Where workspaces run. Open one to add credentials, sizes, and regions."
      >
        {addButton}
      </DashboardHeader>

      {!ready || isLoading ? (
        <ProvidersSkeleton />
      ) : (
        <div className="space-y-12">
          {groups.map((group) => (
            <section key={group.state} className="space-y-4">
              <SectionHeading
                title={group.title}
                count={group.providers.length}
                description={group.description}
              />
              <Panel>
                {group.providers.map((provider) => (
                  <ProviderLink key={provider.id} provider={provider} />
                ))}
              </Panel>
            </section>
          ))}

          <AwsProviderSection awsProviders={awsProviders} />

          {(providers?.length ?? 0) === 0 && (
            <p className="text-[14px] text-fg-3">
              No cloud providers yet. Run the seed script to add the defaults.
            </p>
          )}
        </div>
      )}
    </DashboardShell>
  );
}

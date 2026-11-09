"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { Check, ChevronRight, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpcClient } from "@/utils/trpc";

import { Panel, SectionHeading, StatusDot } from "@/components/dashboard/kit";
import { providerStatus } from "../../_components/admin";
import type { ProviderRow } from "./types";

interface AwsProviderSectionProps {
  awsProviders: ProviderRow[];
}

/**
 * Resolve the canonical region for an AWS provider.
 *
 * AWS providers are created with `name = \`AWS ${meta.name}\`` and a single region row.
 * Legacy/seed data may attach multiple region rows to a single provider, so we cannot
 * trust `regions[0]`. Instead, match by the provider's own name (the source of truth
 * the admin selected at creation time).
 */
function getCanonicalAwsRegion(provider: ProviderRow) {
  if (!provider.regions?.length) return null;
  const stripped = provider.name.replace(/^AWS\s+/i, "").trim();
  return provider.regions.find((r) => r.name === stripped) ?? provider.regions[0] ?? null;
}

function getRegionFlag(region?: ProviderRow["regions"][number] | null) {
  const details = `${region?.name ?? ""} ${region?.location ?? ""}`.toLowerCase();

  if (
    details.includes("virginia") ||
    details.includes("ohio") ||
    details.includes("oregon") ||
    details.includes("california") ||
    details.includes("usa")
  ) {
    return "🇺🇸";
  }
  if (details.includes("canada") || details.includes("montréal")) {
    return "🇨🇦";
  }
  if (details.includes("são paulo") || details.includes("brazil")) {
    return "🇧🇷";
  }
  if (details.includes("ireland")) {
    return "🇮🇪";
  }
  if (details.includes("london") || details.includes("uk")) {
    return "🇬🇧";
  }
  if (details.includes("paris") || details.includes("france")) {
    return "🇫🇷";
  }
  if (details.includes("frankfurt") || details.includes("germany")) {
    return "🇩🇪";
  }
  if (details.includes("stockholm") || details.includes("sweden")) {
    return "🇸🇪";
  }
  if (details.includes("milan") || details.includes("italy")) {
    return "🇮🇹";
  }
  if (details.includes("tokyo") || details.includes("japan")) {
    return "🇯🇵";
  }
  if (details.includes("seoul") || details.includes("south korea")) {
    return "🇰🇷";
  }
  if (details.includes("singapore")) {
    return "🇸🇬";
  }
  if (details.includes("sydney") || details.includes("australia")) {
    return "🇦🇺";
  }
  if (details.includes("mumbai") || details.includes("india")) {
    return "🇮🇳";
  }
  if (details.includes("bahrain")) {
    return "🇧🇭";
  }
  if (details.includes("cape town") || details.includes("south africa")) {
    return "🇿🇦";
  }

  return "🌍";
}

export function AwsProviderSection({ awsProviders }: AwsProviderSectionProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const { data: supportedRegions, isLoading: isLoadingRegions } = useQuery({
    queryKey: ["admin", "aws", "supportedRegions"],
    queryFn: () => trpcClient.admin.aws.listSupportedRegions.query(),
    enabled: isAddOpen,
  });

  const createRegionProvider = useMutation({
    mutationFn: (params: { regionIdentifier: string; name?: string }) =>
      trpcClient.admin.aws.createRegionProvider.mutate(params),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "aws", "supportedRegions"] });
      setIsAddOpen(false);
      setSelectedRegion(null);
      setLabel("");
      toast.success(`Created ${data.provider.name}`);
      router.push(`/admin/providers/${data.provider.id}` as Route);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <section className="space-y-4">
        <SectionHeading
          title={
            <span className="inline-flex items-center gap-2.5">
              <Image src="/aws.svg" alt="" width={22} height={22} className="h-[18px] w-auto" />
              AWS regions
            </span>
          }
          count={awsProviders.length || undefined}
          description="Each region runs its own ECS cluster, load balancer, and EFS stack."
          action={
            <Button variant="secondary" onClick={() => setIsAddOpen(true)}>
              <Plus className="size-4" />
              Add region
            </Button>
          }
        />
        {awsProviders.length === 0 ? (
          <div className="rounded-xl border border-line px-4 py-4 sm:px-5">
            <p className="text-[14px] font-medium text-fg-2">No regions yet</p>
            <p className="mt-0.5 text-[13px] text-fg-3">
              Add one, then give it credentials and provision its stack.
            </p>
          </div>
        ) : (
          <Panel>
            {awsProviders.map((provider) => {
              const region = getCanonicalAwsRegion(provider);
              const status = providerStatus(provider);
              return (
                <Link
                  key={provider.id}
                  href={`/admin/providers/${provider.id}` as Route}
                  className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none sm:px-5"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill text-base"
                  >
                    {getRegionFlag(region)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[14px] font-medium text-fg">
                        {provider.name}
                      </span>
                      {region ? (
                        <span className="shrink-0 font-mono text-[12.5px] text-fg-4">
                          {region.externalRegionIdentifier}
                        </span>
                      ) : null}
                    </p>
                    {region?.location ? (
                      <p className="mt-0.5 truncate text-[13px] text-fg-3">{region.location}</p>
                    ) : null}
                  </div>
                  <StatusDot tone={status.tone} className="shrink-0">
                    {status.label}
                  </StatusDot>
                  <ChevronRight className="size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg" />
                </Link>
              );
            })}
          </Panel>
        )}
      </section>
      <Dialog
        open={isAddOpen}
        onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            setSelectedRegion(null);
            setLabel("");
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add an AWS region</DialogTitle>
            <DialogDescription>
              Pick a region to register. Credentials and infrastructure are provisioned in the next
              step.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              {isLoadingRegions ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl bg-fill" />
                  ))}
                </div>
              ) : (
                <div className="grid max-h-[340px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                  {supportedRegions?.map((region) => {
                    const isSelected = selectedRegion === region.identifier;
                    const isDisabled = region.inUse;
                    return (
                      <button
                        key={region.identifier}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          const previousRegion = supportedRegions?.find(
                            (candidate) => candidate.identifier === selectedRegion,
                          );
                          setSelectedRegion(region.identifier);
                          if (!label.trim() || label === `AWS ${previousRegion?.name}`) {
                            setLabel(`AWS ${region.name}`);
                          }
                        }}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-xl p-3 text-left transition-colors",
                          isDisabled
                            ? "cursor-not-allowed bg-fill opacity-50"
                            : isSelected
                              ? "bg-primary/10 ring-1 ring-primary/45 ring-inset"
                              : "bg-fill hover:bg-fill-2",
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors",
                            isSelected ? "bg-primary/15" : "bg-fill-2",
                          )}
                        >
                          <span>{region.flag}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-[14px] font-medium text-fg">
                              {region.name}
                            </p>
                            {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                          </div>
                          <p className="font-mono text-[12.5px] text-fg-3">{region.identifier}</p>
                        </div>
                        {region.inUse && (
                          <span className="absolute top-2 right-2 rounded-full bg-fill-2 px-2 py-0.5 text-[12px] text-fg-3">
                            In use
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="aws-label">Display label</Label>
              <Input
                id="aws-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., AWS US East (N. Virginia)"
                disabled={!selectedRegion}
              />
              <p className="text-[13px] text-fg-3">
                Shown to users when they pick a cloud at workspace creation.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setIsAddOpen(false)}
              disabled={createRegionProvider.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedRegion) {
                  toast.error("Pick a region first.");
                  return;
                }
                createRegionProvider.mutate({
                  regionIdentifier: selectedRegion,
                  name: label.trim() || undefined,
                });
              }}
              disabled={!selectedRegion || createRegionProvider.isPending}
            >
              {createRegionProvider.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Create region provider
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

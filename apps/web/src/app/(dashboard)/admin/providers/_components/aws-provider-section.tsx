"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { ArrowUpRight, Check, ChevronDown, Loader2, Plus } from "lucide-react";

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

import { StatusChip } from "./status-chip";
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

  const [isExpanded, setIsExpanded] = useState(false);
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

  const awsCount = awsProviders.length;
  const configured = awsProviders.filter((p) => p.providerConfig?.isEnabled).length;
  const needsSetup = awsProviders.some((p) => !p.providerConfig);
  const allDisabled = awsCount > 0 && awsProviders.every((p) => !p.isEnabled);

  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-card">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
          aria-expanded={isExpanded}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill">
            <Image src="/aws.svg" alt="AWS" width={22} height={22} className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="text-[15px] font-medium text-fg">AWS</h3>
              <span className="text-[13px] text-fg-4">Region-scoped</span>
              {awsCount === 0 ? (
                <StatusChip tone="warn">Not configured</StatusChip>
              ) : needsSetup ? (
                <StatusChip tone="warn">
                  {configured}/{awsCount} configured
                </StatusChip>
              ) : allDisabled ? (
                <StatusChip>All disabled</StatusChip>
              ) : (
                <StatusChip tone="ok">{configured} active</StatusChip>
              )}
            </div>
            <p className="mt-1 text-[13px] text-fg-3">
              {awsCount === 0
                ? "Each region runs its own ECS cluster, ALB, and EFS stack."
                : `${awsCount} region${awsCount === 1 ? "" : "s"} · ${
                    awsProviders
                      .slice(0, 3)
                      .map((p) => getCanonicalAwsRegion(p)?.externalRegionIdentifier)
                      .filter(Boolean)
                      .join(", ") || "-"
                  }${awsCount > 3 ? ` +${awsCount - 3}` : ""}`}
            </p>
          </div>

          <span className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <span className="hidden sm:inline" aria-hidden>
              {isExpanded ? "Collapse" : "Expand"}
            </span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                isExpanded && "rotate-180 text-fg",
              )}
            />
          </span>
        </button>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="px-5 pt-1 pb-5">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {awsProviders.map((provider) => {
                  const primaryRegion = getCanonicalAwsRegion(provider);
                  const regionFlag = getRegionFlag(primaryRegion);
                  return (
                    <Link
                      key={provider.id}
                      href={`/admin/providers/${provider.id}` as Route}
                      className="group/card flex items-center gap-3 rounded-xl bg-fill p-3.5 transition-colors hover:bg-fill-2 focus-visible:bg-fill-2 focus-visible:outline-none"
                    >
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill-2 text-base"
                      >
                        {regionFlag}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-mono text-[13.5px] font-medium text-fg">
                            {primaryRegion?.externalRegionIdentifier ?? provider.name}
                          </p>
                          <ArrowUpRight className="size-3.5 shrink-0 text-fg-3 opacity-0 transition-opacity group-hover/card:opacity-100" />
                        </div>
                        {primaryRegion?.location && (
                          <p className="truncate text-[12.5px] text-fg-3">
                            {primaryRegion.location}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                          {provider.providerConfig?.isEnabled ? (
                            <span className="inline-flex items-center gap-1.5 text-[#6bd586]">
                              <span className="size-1.5 rounded-full bg-[#6bd586]" />
                              Active
                            </span>
                          ) : provider.providerConfig ? (
                            <span className="inline-flex items-center gap-1.5 text-fg-3">
                              <span className="size-1.5 rounded-full bg-fg-4" />
                              Config disabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[#fb923c]">
                              <span className="size-1.5 rounded-full bg-[#fb923c]" />
                              Needs setup
                            </span>
                          )}
                          {!provider.isEnabled && <span className="text-fg-3">· Disabled</span>}
                        </div>
                      </div>
                    </Link>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsAddOpen(true)}
                  className="group/add flex items-center gap-3 rounded-xl p-3.5 text-left transition-colors hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill">
                    <Plus className="size-4 text-fg-3 transition-colors group-hover/add:text-primary" />
                  </span>
                  <div>
                    <p className="text-[14px] font-medium text-fg-2">Add a region</p>
                    <p className="text-[12.5px] text-fg-3">Pick and provision</p>
                  </div>
                </button>
              </div>

              {awsCount === 0 && (
                <p className="mt-3 text-[13px] text-fg-3">
                  No regions yet. Each region is configured independently with its own credentials
                  and SSH policy.
                </p>
              )}
            </div>
          </div>
        </div>
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
                              ? "bg-primary/10 shadow-[inset_0_0_0_1px_rgba(211,173,85,0.45)]"
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

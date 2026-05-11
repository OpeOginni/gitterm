"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Loader2,
  Plus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

  if (details.includes("virginia") || details.includes("ohio") || details.includes("oregon") || details.includes("california") || details.includes("usa")) {
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
      <div
        className={cn(
          "group relative overflow-hidden rounded-2xl border bg-card transition-colors",
          isExpanded ? "border-amber-500/20" : "border-border hover:border-amber-400/20",
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/[0.05] blur-3xl transition-opacity duration-300",
            isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        />

        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="relative flex w-full items-center gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
          aria-expanded={isExpanded}
        >
          <div className="rounded-xl border border-border bg-foreground/[0.02] p-2.5">
            <Image src="/ECS.svg" alt="AWS" width={22} height={22} className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-foreground/90">AWS</h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                region-scoped
              </span>
              {awsCount === 0 ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/20 bg-amber-500/10 text-amber-400 text-[10px]"
                >
                  Not Configured
                </Badge>
              ) : needsSetup ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/20 bg-amber-500/10 text-amber-400 text-[10px]"
                >
                  {configured}/{awsCount} Configured
                </Badge>
              ) : allDisabled ? (
                <Badge
                  variant="outline"
                  className="border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground text-[10px]"
                >
                  All Disabled
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-[10px]"
                >
                  {configured} Active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {awsCount === 0
                ? "Each region runs its own ECS cluster, ALB, and EFS stack."
                : `${awsCount} region${awsCount === 1 ? "" : "s"} · ${
                    awsProviders
                      .slice(0, 3)
                      .map((p) => getCanonicalAwsRegion(p)?.externalRegionIdentifier)
                      .filter(Boolean)
                      .join(", ") || "—"
                  }${awsCount > 3 ? ` +${awsCount - 3}` : ""}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:inline"
              aria-hidden
            >
              {isExpanded ? "collapse" : "expand"}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground/70 transition-transform duration-200",
                isExpanded && "rotate-180 text-foreground/80",
              )}
            />
          </div>
        </button>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="relative border-t border-border/60 bg-foreground/[0.015] p-4">
              <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:radial-gradient(circle_at_1px_1px,_currentColor_1px,_transparent_0)] [background-size:14px_14px]" />

              <div className="relative grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {awsProviders.map((provider) => {
                  const primaryRegion = getCanonicalAwsRegion(provider);
                  const regionFlag = getRegionFlag(primaryRegion);
                  return (
                    <Link
                      key={provider.id}
                      href={`/admin/providers/${provider.id}` as Route}
                      className="group/card relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:border-amber-400/30 hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                    >
                      <div className="flex items-center  gap-3">
                        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border bg-foreground/[0.03] text-base">
                          <span aria-hidden>{regionFlag}</span>
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-foreground/90">
                              {primaryRegion?.externalRegionIdentifier ?? provider.name}
                            </p>
                            <ArrowUpRight className="h-3 w-3 translate-y-0.5 text-muted-foreground/40 opacity-0 transition-all group-hover/card:opacity-100" />
                          </div>
                          {primaryRegion?.location && (
                            <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              {primaryRegion.location}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {provider.providerConfig?.isEnabled ? (
                              <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-emerald-400">
                                <span className="h-1 w-1 rounded-full bg-emerald-400" />
                                Active
                              </span>
                            ) : provider.providerConfig ? (
                              <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                                <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                                Config Disabled
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-amber-400">
                                <span className="h-1 w-1 rounded-full bg-amber-400" />
                                Needs Setup
                              </span>
                            )}
                            {!provider.isEnabled && (
                              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                                · Disabled
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsAddOpen(true)}
                  className="group/add relative flex items-center gap-3 rounded-xl border border-dashed border-border bg-transparent p-4 text-left transition-all hover:border-amber-400/40 hover:bg-amber-500/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                >
                  <div className="rounded-lg border border-dashed border-border bg-foreground/[0.02] p-2 transition-colors group-hover/add:border-amber-400/40">
                    <Plus className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover/add:text-amber-400" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground/80">Add a region</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      pick &amp; provision
                    </p>
                  </div>
                </button>
              </div>

              {awsCount === 0 && (
                <p className="relative mt-3 text-center text-[11px] text-muted-foreground">
                  No regions yet. Each region is configured independently with its own credentials
                  and SSH policy.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

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
            <div className="pb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              aws / region
            </div>
            <DialogTitle>Add an AWS Region</DialogTitle>
            <DialogDescription>
              Pick a region to register. Credentials and infrastructure are provisioned in the next
              step.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="relative">
              <div className="pointer-events-none absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br from-amber-500/[0.02] via-transparent to-transparent" />

              {isLoadingRegions ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl" />
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
                          setSelectedRegion(region.identifier);
                          if (!label) {
                            setLabel(`AWS ${region.name}`);
                          }
                        }}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                          isDisabled
                            ? "cursor-not-allowed border-border/40 bg-foreground/[0.01] opacity-50"
                            : isSelected
                              ? "border-amber-400/40 bg-amber-500/[0.06] shadow-[0_0_0_1px_rgba(251,191,36,0.15)]"
                              : "border-border bg-card hover:border-foreground/20 hover:bg-foreground/[0.02]",
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors",
                            isSelected
                              ? "bg-amber-500/15"
                              : "bg-foreground/[0.04] group-hover:bg-foreground/[0.06]",
                          )}
                        >
                          <span>{region.flag}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-foreground/90">
                              {region.name}
                            </p>
                            {isSelected && <Check className="h-3 w-3 shrink-0 text-amber-400" />}
                          </div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {region.identifier}
                          </p>
                        </div>
                        {region.inUse && (
                          <span className="absolute right-2 top-2 rounded-full border border-border bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            in use
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="aws-label">Display Label</Label>
              <Input
                id="aws-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., AWS US East (N. Virginia)"
                disabled={!selectedRegion}
              />
              <p className="text-[11px] text-muted-foreground">
                Shown to users when they pick a cloud at workspace creation.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
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
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {createRegionProvider.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Region Provider
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

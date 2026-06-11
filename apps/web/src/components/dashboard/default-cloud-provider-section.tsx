"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, Cloud, Loader2, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import { getIcon } from "@/components/dashboard/create-instance/types";

interface CloudProviderOption {
  id: string;
  name: string;
  providerKey: string;
  autoPersistent?: boolean;
  regions?: { id: string; name: string }[];
}

export function DefaultCloudProviderSection() {
  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
  );

  const { data: defaultData, isLoading: isLoadingDefault } = useQuery(
    trpc.user.getDefaultCloudProvider.queryOptions(),
  );

  const providers = (providersData?.cloudProviders ?? []) as CloudProviderOption[];
  const selectedId = defaultData?.cloudProviderId ?? null;

  const setDefaultMutation = useMutation(
    trpc.user.setDefaultCloudProvider.mutationOptions({
      onMutate: async ({ cloudProviderId }) => {
        const queryKey = trpc.user.getDefaultCloudProvider.queryKey();
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, { cloudProviderId });
        return { previous, queryKey };
      },
      onError: (error, _vars, context) => {
        if (context) {
          queryClient.setQueryData(context.queryKey, context.previous);
        }
        toast.error(error.message);
      },
      onSuccess: (result) => {
        if (result.cloudProviderId) {
          const provider = providers.find((p) => p.id === result.cloudProviderId);
          toast.success(`Default provider set to ${provider?.name ?? "selection"}`);
        } else {
          toast.success("Default provider cleared");
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.user.getDefaultCloudProvider.queryKey(),
        });
      },
    }),
  );

  const isBusy = isLoadingProviders || isLoadingDefault;
  const pendingId = setDefaultMutation.isPending
    ? setDefaultMutation.variables?.cloudProviderId
    : undefined;

  const hasProviders = providers.length > 0;

  // The unset state still resolves to *something* in the create dialogs (first
  // available). Surface that so the choice is never a mystery.
  const fallbackName = useMemo(() => providers[0]?.name ?? null, [providers]);

  const handleSelect = (id: string | null) => {
    if (id === selectedId) return;
    setDefaultMutation.mutate({ cloudProviderId: id });
  };

  return (
    <SettingsSection
      eyebrow="01 / Compute"
      icon={Cloud}
      title="Default cloud provider"
      description="Pre-selects the compute target when you spin up a new instance or agent loop. Only providers your admin has enabled appear here."
    >
      <SettingsSectionBody className="space-y-4">
        {isBusy ? (
          <div className="flex items-center gap-2 py-8 text-sm text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading providers...
          </div>
        ) : !hasProviders ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-6">
            <p className="text-sm text-white/55">No cloud providers are enabled yet.</p>
            <Link
              href={"/admin/providers" as Route}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Manage providers
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {providers.map((provider) => {
                const isSelected = provider.id === selectedId;
                const isPending = provider.id === pendingId;
                const regionCount = provider.regions?.length ?? 0;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => handleSelect(provider.id)}
                    disabled={setDefaultMutation.isPending}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all",
                      isSelected
                        ? "border-primary/50 bg-primary/[0.07] shadow-[0_0_0_1px_rgba(200,164,78,0.25)]"
                        : "border-white/[0.07] bg-white/[0.015] hover:border-white/[0.14] hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                        isSelected ? "bg-primary/15" : "bg-white/[0.05]",
                      )}
                    >
                      <Image
                        src={getIcon(provider.name)}
                        alt={provider.name}
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px]"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white/90">{provider.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/35">
                        {regionCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {regionCount} {regionCount === 1 ? "region" : "regions"}
                          </span>
                        )}
                        {provider.autoPersistent && (
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Persistent
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : isSelected ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-white/15 transition-colors group-hover:border-white/30" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.04] pt-3">
              <p className="text-[11px] text-white/30">
                {selectedId
                  ? "Used as the starting selection. You can still change it per instance."
                  : fallbackName
                    ? `No default set — new instances start on ${fallbackName}.`
                    : "No default set."}
              </p>
              {selectedId && (
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  disabled={setDefaultMutation.isPending}
                  className="text-[11px] font-medium text-white/45 transition-colors hover:text-white/70 disabled:opacity-50"
                >
                  Clear default
                </button>
              )}
            </div>
          </>
        )}
      </SettingsSectionBody>
    </SettingsSection>
  );
}

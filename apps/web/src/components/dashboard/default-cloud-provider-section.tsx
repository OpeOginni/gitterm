"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, CircleHelp, Cloud, Loader2, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
import { getIcon } from "@/components/dashboard/create-instance/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CloudProviderOption {
  id: string;
  name: string;
  providerKey: string;
  autoPersistent?: boolean;
  regions?: { id: string; name: string }[];
}

export function DefaultCloudProviderSection() {
  const { data: session } = authClient.useSession();
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
        const provider = providers.find((p) => p.id === result.cloudProviderId);
        toast.success(`Default provider set to ${provider?.name ?? "selection"}`);
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

  const handleSelect = (id: string) => {
    if (id === selectedId) return;
    setDefaultMutation.mutate({ cloudProviderId: id });
  };

  return (
    <SettingsSection
      icon={Cloud}
      title="Default cloud provider"
      description="Pre-selects the compute target when you spin up a new instance or agent loop. Only providers your admin has enabled appear here."
    >
      <SettingsSectionBody className="space-y-4">
        {isBusy ? (
          <div className="flex items-center gap-2 py-8 text-sm text-fg-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading providers...
          </div>
        ) : !hasProviders ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-fill px-4 py-6">
            <p className="text-sm text-fg-3">No cloud providers are enabled yet.</p>
            {session?.user.role === "admin" && (
              <Link
                href={"/admin/providers" as Route}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Manage providers
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
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
                        : "border-line bg-fill hover:border-line-2 hover:bg-fill",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                        isSelected ? "bg-primary/15" : "bg-fill",
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
                      <p className="truncate text-sm font-medium text-fg">{provider.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-4">
                        {regionCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {regionCount} {regionCount === 1 ? "region" : "regions"}
                          </span>
                        )}
                        {provider.autoPersistent && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-flex cursor-help items-center gap-1"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Sparkles className="h-3 w-3" />
                                Auto-persistent
                                <CircleHelp className="h-3 w-3" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="max-w-none whitespace-nowrap bg-settings-dialog px-2.5 py-1.5 text-[11px] text-fg-2"
                            >
                              Data persists through pauses. No volume setup.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : isSelected ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-line-2 transition-colors group-hover:border-line-2" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </SettingsSectionBody>
    </SettingsSection>
  );
}

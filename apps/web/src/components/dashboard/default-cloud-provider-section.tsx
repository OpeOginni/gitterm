"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleHelp, Cloud, Loader2, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { SettingsEmpty } from "@/components/dashboard/settings/settings-page";
import { LineCell, LineGrid, SectionHeading, StatusDot } from "@/components/dashboard/kit";
import {
  formatHourlyPrice,
  formatMachineSize,
  getIcon,
  type CloudProvider,
} from "@/components/dashboard/create-instance/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function DefaultCloudProviderSection() {
  const { data: session } = authClient.useSession();
  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
  );

  const { data: defaultData, isLoading: isLoadingDefault } = useQuery(
    trpc.user.getDefaultCloudProvider.queryOptions(),
  );

  const providers = (providersData?.cloudProviders ?? []) as CloudProvider[];
  const selectedId = defaultData?.cloudProviderId ?? null;
  const hasPrices = providers.some((provider) =>
    provider.machineProfiles?.some((size) => size.priceMicrosPerHour != null),
  );

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

  const pendingId = setDefaultMutation.isPending
    ? setDefaultMutation.variables?.cloudProviderId
    : undefined;

  const handleSelect = (id: string) => {
    if (id === selectedId) return;
    setDefaultMutation.mutate({ cloudProviderId: id });
  };

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Default provider"
        count={providers.length || undefined}
        description={
          hasPrices || isLoadingProviders
            ? "Hourly prices on your plan. Any workspace can still pick another."
            : "Any workspace can still pick another when you create it."
        }
      />
      {isLoadingProviders || isLoadingDefault ? (
        <LineGrid className="md:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <ProviderCellSkeleton key={index} />
          ))}
        </LineGrid>
      ) : providers.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <SettingsEmpty
            icon={<Cloud />}
            title="No cloud providers yet"
            description="Your admin turns providers on. Until then, workspaces can't start in the cloud."
          />
          {session?.user.role === "admin" && (
            <Link
              href={"/admin/providers" as Route}
              className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-medium text-primary hover:underline"
            >
              Manage providers
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      ) : (
        <LineGrid className="md:grid-cols-2">
          <div role="radiogroup" aria-label="Default provider" className="contents">
            {providers.map((provider) => (
              <ProviderCell
                key={provider.id}
                provider={provider}
                selected={provider.id === selectedId}
                pending={provider.id === pendingId}
                disabled={setDefaultMutation.isPending}
                onSelect={() => handleSelect(provider.id)}
              />
            ))}
            {providers.length % 2 === 1 ? (
              <LineCell className="hidden md:flex">{null}</LineCell>
            ) : null}
          </div>
        </LineGrid>
      )}
    </section>
  );
}

/** A provider card's shape: icon, name and details, then three sizes with prices. */
function ProviderCellSkeleton() {
  return (
    <LineCell className="gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg bg-fill-2" />
        <div className="min-w-0 flex-1">
          <div className="flex h-[22px] items-center">
            <Skeleton className="h-3.5 w-24 bg-fill-2" />
          </div>
          <div className="mt-0.5 flex h-[18px] items-center">
            <Skeleton className="h-3 w-36 bg-fill-2" />
          </div>
        </div>
        <Skeleton className="size-3.5 shrink-0 rounded-full bg-fill-2" />
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex h-[34px] items-center gap-3 py-2 last:h-[26px] last:pb-0">
            <Skeleton className="h-3 w-12 bg-fill-2" />
            <Skeleton className="h-3 w-24 bg-fill-2" />
            <Skeleton className="ml-auto h-3 w-14 bg-fill-2" />
          </li>
        ))}
      </ul>
    </LineCell>
  );
}

/** One provider: what it offers (regions, persistence, sizes and prices), and a radio. */
function ProviderCell({
  provider,
  selected,
  pending,
  disabled,
  onSelect,
}: {
  provider: CloudProvider;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const regionCount = provider.regions?.length ?? 0;
  const sizes = provider.machineProfiles ?? [];

  return (
    <LineCell className="p-0">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        disabled={disabled}
        className={cn(
          "flex h-full w-full flex-col gap-4 p-5 text-left transition-colors disabled:cursor-default",
          selected ? "bg-fill" : "hover:bg-fill",
        )}
      >
        <div className="flex w-full items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill-2">
            <Image
              src={getIcon(provider.name)}
              alt=""
              width={18}
              height={18}
              className="size-[18px] object-contain"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium text-fg">{provider.name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-fg-3">
              {regionCount > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {regionCount} {regionCount === 1 ? "region" : "regions"}
                </span>
              ) : provider.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {provider.location}
                </span>
              ) : null}
              {provider.autoPersistent ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex cursor-help items-center gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Sparkles className="size-3" />
                      Keeps files
                      <CircleHelp className="size-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-none bg-settings-dialog px-2.5 py-1.5 text-[12.5px] whitespace-nowrap text-fg-2"
                  >
                    Data persists through pauses. No volume setup.
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center">
            {pending ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : selected ? (
              <StatusDot tone="busy">Default</StatusDot>
            ) : (
              <span
                aria-hidden
                className="size-3.5 rounded-full border border-line-2 transition-colors"
              />
            )}
          </span>
        </div>

        {sizes.length > 0 ? (
          <ul className="w-full divide-y divide-line border-t border-line">
            {sizes.map((size) => {
              const unavailable = size.available === false;
              const spec = formatMachineSize(size);
              return (
                <li
                  key={size.id}
                  className={cn(
                    "flex items-baseline gap-3 py-2 text-[12.5px] last:pb-0",
                    unavailable ? "text-fg-4" : "text-fg-3",
                  )}
                >
                  <span className={cn("w-16 shrink-0", unavailable ? "text-fg-4" : "text-fg-2")}>
                    {size.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{spec ?? ""}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {unavailable
                      ? "Not on your plan"
                      : size.priceMicrosPerHour != null
                        ? formatHourlyPrice(size.priceMicrosPerHour)
                        : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </button>
    </LineCell>
  );
}

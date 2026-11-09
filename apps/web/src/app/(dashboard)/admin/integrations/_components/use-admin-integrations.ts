"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

export function useAdminIntegrations(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({ ...trpc.admin.integrations.list.queryOptions(), enabled });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.admin.integrations.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.integrations.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.googleCloud.availability.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.github.appAvailability.queryKey() }),
    ]);
  }

  return { ...query, refresh };
}

export type AdminIntegrationsData = NonNullable<ReturnType<typeof useAdminIntegrations>["data"]>;

export type IntegrationStatus = "enabled" | "disabled" | "unconfigured" | "planned";

export function integrationStatus(
  item: AdminIntegrationsData["integrations"][number],
  data: AdminIntegrationsData,
): IntegrationStatus {
  if (!item.ready) return "planned";
  const configured =
    item.key === "github" ? !!data.githubMode : item.key === "google" ? !!data.google : true;
  // On without credentials still can't work for users.
  if (!configured) return "unconfigured";
  return item.enabled ? "enabled" : "disabled";
}

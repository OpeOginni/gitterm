"use client";

import { useEffect } from "react";
import { queryClient, trpc } from "@/utils/trpc";

/**
 * Warm the React Query cache for everything the create-instance dialog needs
 * (cloud providers, agent types, GitHub installations, the user's default
 * provider, model credentials, etc).
 *
 * Called from the always-mounted dialog trigger so the data is already present
 * the moment the dialog opens — no spinner flicker and, crucially, no layout
 * jump when the auto-selected agent's description card resolves in.
 */
export function usePrefetchCreateInstanceData() {
  useEffect(() => {
    // Cloud instance flow
    void queryClient.prefetchQuery(trpc.workspace.listAgentTypes.queryOptions());
    void queryClient.prefetchQuery(
      trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
    );
    void queryClient.prefetchQuery(trpc.workspace.listUserInstallations.queryOptions());
    void queryClient.prefetchQuery(trpc.user.getDefaultCloudProvider.queryOptions());
    void queryClient.prefetchQuery(trpc.workspace.getSubdomainPermissions.queryOptions());
    void queryClient.prefetchQuery(trpc.user.getSshPublicKey.queryOptions());

    // Agent loop flow
    void queryClient.prefetchQuery(
      trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true, sandboxOnly: true }),
    );
    void queryClient.prefetchQuery(trpc.modelCredentials.listProviders.queryOptions());
    void queryClient.prefetchQuery(trpc.modelCredentials.listModels.queryOptions());
    void queryClient.prefetchQuery(trpc.modelCredentials.listMyCredentials.queryOptions());
    void queryClient.prefetchQuery(trpc.agentLoop.getUsage.queryOptions());
  }, []);
}

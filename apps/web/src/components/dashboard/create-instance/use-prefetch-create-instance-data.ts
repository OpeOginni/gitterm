"use client";

import { useEffect } from "react";
import { queryClient, trpc } from "@/utils/trpc";

export function usePrefetchCreateInstanceData() {
  useEffect(() => {
    void queryClient.prefetchQuery(trpc.workspace.getWorkspaceCatalog.queryOptions());
    void queryClient.prefetchQuery(
      trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
    );
    void queryClient.prefetchQuery(trpc.workspace.listUserInstallations.queryOptions());
    void queryClient.prefetchQuery(trpc.user.getDefaultCloudProvider.queryOptions());
    void queryClient.prefetchQuery(trpc.workspace.getSubdomainPermissions.queryOptions());
    void queryClient.prefetchQuery(trpc.user.getSshPublicKey.queryOptions());
    void queryClient.prefetchQuery(trpc.modelCredentials.listMyCredentials.queryOptions());
  }, []);
}

"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { listenerTrpc, queryClient, trpc } from "@/utils/trpc";
import { toast } from "sonner";

type WatchParams = { workspaceId: string; userId: string };

type SubscriptionHandle = { unsubscribe: () => void };

type Ctx = {
  watchWorkspaceStatus: (params: WatchParams) => void;
  unwatchWorkspaceStatus: (workspaceId: string) => void;
};

const WorkspaceStatusWatcherContext = createContext<Ctx | null>(null);

export function WorkspaceStatusWatcherProvider({ children }: { children: React.ReactNode }) {
  const subsRef = useRef(new Map<string, SubscriptionHandle>());

  const unwatchWorkspaceStatus = useCallback((workspaceId: string) => {
    const existing = subsRef.current.get(workspaceId);
    if (existing) {
      existing.unsubscribe();
      subsRef.current.delete(workspaceId);
    }
  }, []);

  const watchWorkspaceStatus = useCallback(
    ({ workspaceId, userId }: WatchParams) => {
      // Ensure only one active subscription per workspace.
      if (subsRef.current.has(workspaceId)) return;

      const sub = listenerTrpc.workspace.status.subscribe(
        { workspaceId, userId },
        {
          onData: (payload) => {
            if (payload.status === "running") {
              toast.success("Your Workspace is ready");
              queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
              sub.unsubscribe();
              subsRef.current.delete(workspaceId);
            }
          },
          onError: (error) => {
            // Don't spam toasts if the SSE connection is flapping; keep it console-visible.
            console.error("[workspace-status] subscription error", error);
            sub.unsubscribe();
            subsRef.current.delete(workspaceId);
          },
        },
      );

      subsRef.current.set(workspaceId, sub);
    },
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      watchWorkspaceStatus,
      unwatchWorkspaceStatus,
    }),
    [watchWorkspaceStatus, unwatchWorkspaceStatus],
  );

  return (
    <WorkspaceStatusWatcherContext.Provider value={value}>
      {children}
    </WorkspaceStatusWatcherContext.Provider>
  );
}

export function useWorkspaceStatusWatcher(): Ctx {
  const ctx = useContext(WorkspaceStatusWatcherContext);
  if (!ctx) {
    throw new Error("useWorkspaceStatusWatcher must be used within WorkspaceStatusWatcherProvider");
  }
  return ctx;
}



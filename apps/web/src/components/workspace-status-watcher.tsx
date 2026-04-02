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

  const watchWorkspaceStatus = useCallback(({ workspaceId, userId }: WatchParams) => {
    // Ensure only one active subscription per workspace.
    if (subsRef.current.has(workspaceId)) return;

    let isInitialEvent = true;
    let lastStatus: string | null = null;

    const sub = listenerTrpc.workspace.status.subscribe(
      { workspaceId, userId },
      {
        onData: (payload) => {
          const isInitialStatus = isInitialEvent;
          isInitialEvent = false;

          if (payload.status === lastStatus) {
            return;
          }
          lastStatus = payload.status;

          if (payload.status === "pending") {
            toast.success("Workspace is provisioning");
            queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
            return;
          }

          if (payload.status === "running") {
            toast.success(
              isInitialStatus ? "Workspace created successfully" : "Your Workspace is ready",
            );
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
  }, []);

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

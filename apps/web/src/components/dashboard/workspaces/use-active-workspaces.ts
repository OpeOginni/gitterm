import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/utils/trpc";

const FETCH_LIMIT = 100;

/** Every active workspace and sandbox, fetched page by page, so lists see the whole set. */
export function useActiveWorkspaces() {
  return useQuery({
    ...trpc.workspace.listWorkspaces.queryOptions({ status: "active", limit: FETCH_LIMIT }),
    queryFn: async () => {
      const first = await trpcClient.workspace.listWorkspaces.query({
        status: "active",
        limit: FETCH_LIMIT,
      });
      const workspaces = [...first.workspaces];
      while (workspaces.length < first.pagination.total) {
        const next = await trpcClient.workspace.listWorkspaces.query({
          status: "active",
          limit: FETCH_LIMIT,
          offset: workspaces.length,
        });
        if (next.workspaces.length === 0) break;
        workspaces.push(...next.workspaces);
      }
      return { ...first, workspaces };
    },
    // Starting workspaces turn running on their own; check back until they do.
    refetchInterval: (q) =>
      q.state.data?.workspaces.some((w) => w.status === "pending") ? 4000 : false,
  });
}

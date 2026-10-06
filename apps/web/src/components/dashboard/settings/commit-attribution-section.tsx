"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Switch } from "@/components/ui/switch";

export function CommitAttributionSection() {
  const query = useQuery(trpc.user.getCommitAttribution.queryOptions());
  const mutation = useMutation(
    trpc.user.setCommitAttribution.mutationOptions({
      onSuccess: (result) => {
        queryClient.setQueryData(trpc.user.getCommitAttribution.queryKey(), result);
        toast.success("Commit attribution saved");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-card px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fill">
        <GitCommitHorizontal className="size-4 text-primary opacity-80" />
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor="show-gitterm-on-commits" className="text-sm font-semibold text-fg">
          Attribute GitTerm for commits made in workspaces
        </label>
        <p id="commit-attribution-description" className="mt-0.5 text-xs text-fg-4">
          You stay the author; GitTerm is listed as the committer. Applies to new workspaces.
        </p>
      </div>
      <Switch
        id="show-gitterm-on-commits"
        aria-describedby="commit-attribution-description"
        checked={query.data?.showGitTermOnCommits ?? true}
        onCheckedChange={(showGitTermOnCommits) => mutation.mutate({ showGitTermOnCommits })}
        disabled={!query.data || mutation.isPending}
      />
    </div>
  );
}

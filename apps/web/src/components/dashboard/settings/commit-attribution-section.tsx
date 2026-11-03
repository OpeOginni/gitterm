"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup } from "./settings-page";

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
    <SettingsGroup>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="show-gitterm-on-commits" className="text-[15px] font-medium text-fg">
            Attribute GitTerm for commits made in workspaces
          </label>
          <p
            id="commit-attribution-description"
            className="mt-1 text-[13.5px] leading-relaxed text-fg-3"
          >
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
    </SettingsGroup>
  );
}

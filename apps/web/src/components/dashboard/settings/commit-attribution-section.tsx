"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { SettingsRow, SettingsSection, SettingsSectionBody } from "@/components/ui/form-card";
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
  const enabled = query.data?.showGitTermOnCommits ?? true;

  return (
    <SettingsSection
      title="Commit attribution"
      description="Your work, with a clear record of how it was committed."
    >
      <SettingsSectionBody className="space-y-4">
        <SettingsRow className="sm:items-start">
          <div className="min-w-0">
            <label htmlFor="show-gitterm-on-commits" className="text-sm font-medium text-fg">
              Show GitTerm on my commits
            </label>
            <p
              id="commit-attribution-description"
              className="mt-1 max-w-xl text-[13px] leading-relaxed text-fg-3"
            >
              You stay the author. GitTerm appears as the committer—the tool that created the commit
              on your behalf. Turn this off to use your identity for both.
            </p>
          </div>
          <Switch
            id="show-gitterm-on-commits"
            aria-describedby="commit-attribution-description"
            checked={enabled}
            onCheckedChange={(showGitTermOnCommits) => mutation.mutate({ showGitTermOnCommits })}
            disabled={!query.data || mutation.isPending}
          />
        </SettingsRow>
        <div
          className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-background/40 px-4 py-3"
          aria-live="polite"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-4">Author</p>
            <p className="mt-1 text-sm text-fg">You</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-4">Committer</p>
            <p className="mt-1 text-sm text-fg">{enabled ? "GitTerm" : "You"}</p>
          </div>
        </div>
        {query.isError ? (
          <p className="text-sm text-red-400" role="alert">
            Could not load your preference. Refresh to try again.
          </p>
        ) : null}
        <p className="text-[12px] leading-relaxed text-fg-4">
          Applies to newly created workspaces. Existing workspaces and commits are unchanged. GitHub
          App pushes, pull requests, and comments still use the app identity.
        </p>
      </SettingsSectionBody>
    </SettingsSection>
  );
}

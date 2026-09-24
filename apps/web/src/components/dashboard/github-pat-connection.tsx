"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/utils/trpc";

export function GithubPatConnection() {
  const queryClient = useQueryClient();
  const { data: catalog } = useQuery(trpc.integrations.list.queryOptions());
  const enabled = catalog?.find((entry) => entry.key === "github")?.enabled === true;
  const { data: connections = [] } = useQuery({ ...trpc.githubPat.list.queryOptions(), enabled });
  const create = useMutation(trpc.githubPat.create.mutationOptions());
  const remove = useMutation(trpc.githubPat.remove.mutationOptions());
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  if (!enabled) return null;

  return (
    <section className="rounded-xl border border-line bg-settings p-5">
      <div className="flex items-center gap-3">
        <KeyRound className="size-5 text-fg-2" />
        <div>
          <h3 className="text-sm font-semibold text-fg">Personal access token</h3>
          <p className="mt-0.5 text-xs text-fg-3">
            For email-login deployments, or when you prefer your own GitHub credentials.
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-fg-3">
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg"
        >
          Create a fine-grained PAT in GitHub
        </a>{" "}
        limited to the repositories and permissions you need (Contents: read/write for git;
        additional permissions for other <code>gh</code> operations). GitTerm encrypts the token and
        supplies it only to workspaces you select. A running workspace can use its selected token
        until it is stopped or the token is revoked at GitHub.
      </p>
      {connections.length ? (
        <div className="mt-4 divide-y divide-line rounded-lg border border-line bg-fill">
          {connections.map((connection) => (
            <div key={connection.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{connection.name}</p>
                <p className="font-mono text-[11px] text-fg-4">
                  @{connection.accountLogin} · ends in {connection.tokenSuffix}
                </p>
              </div>
              <button
                type="button"
                disabled={remove.isPending}
                aria-label={`Remove ${connection.name}`}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Remove this token from GitTerm? Revoke it on GitHub to stop access in running workspaces.",
                    )
                  )
                    return;
                  try {
                    await remove.mutateAsync({ id: connection.id });
                    await queryClient.invalidateQueries({
                      queryKey: trpc.githubPat.list.queryKey(),
                    });
                    toast.success("Token removed from GitTerm");
                  } catch {
                    toast.error("Couldn’t remove token");
                  }
                }}
                className="rounded-lg p-2 text-fg-4 hover:bg-red-400/10 hover:text-red-300"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <form
        className="mt-5 grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await create.mutateAsync({ name, token });
            setToken("");
            setName("");
            await queryClient.invalidateQueries({ queryKey: trpc.githubPat.list.queryKey() });
            toast.success("GitHub token connected");
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "Couldn’t connect token");
          }
        }}
      >
        <label className="space-y-1.5 text-xs text-fg-3">
          Name
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Personal GitHub"
            className="bg-fill text-xs"
          />
        </label>
        <label className="space-y-1.5 text-xs text-fg-3">
          Personal access token
          <Input
            required
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="github_pat_…"
            className="bg-fill font-mono text-xs"
          />
        </label>
        <Button
          type="submit"
          disabled={create.isPending || !name.trim() || !token.trim()}
          className="gap-2"
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <KeyRound className="size-4" />
          )}{" "}
          Connect
        </Button>
      </form>
    </section>
  );
}

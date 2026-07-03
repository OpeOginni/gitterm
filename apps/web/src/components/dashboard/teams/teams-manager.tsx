"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Loader2,
  LogOut,
  Mail,
  Plus,
  UsersRound,
  X,
} from "lucide-react";
import { trpc, queryClient } from "@/utils/trpc";
import { authClient, isBillingEnabled } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyInviteLink } from "../share/share-workspace-dialog";

type TeamFilter = "all" | "owned" | "joined";

const TEAMS_PER_PAGE = 6;

export function TeamsManager() {
  const [teamName, setTeamName] = useState("");
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TeamFilter>("all");
  const [page, setPage] = useState(0);

  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  // Creating/managing teams is a paid feature; joined members can still view
  // and leave teams they already belong to.
  const plan = session?.user?.plan ?? "free";
  const sharingLocked = isBillingEnabled && plan === "free";

  const teamsQuery = useQuery(trpc.workspaceShare.listTeams.queryOptions());

  const invalidateTeams = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.workspaceShare.listTeams.queryKey(),
    });

  const createTeamMutation = useMutation(
    trpc.workspaceShare.createTeam.mutationOptions({
      onSuccess: async (data) => {
        toast.success(`Team "${data.team.name}" created`);
        setTeamName("");
        setActiveTeamId(data.team.id);
        await invalidateTeams();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const teams = teamsQuery.data?.teams ?? [];

  const ownedCount = useMemo(
    () => teams.filter((t) => t.creatorId === currentUserId).length,
    [currentUserId, teams],
  );

  const filteredTeams = useMemo(() => {
    if (filter === "owned") return teams.filter((t) => t.creatorId === currentUserId);
    if (filter === "joined") return teams.filter((t) => t.creatorId !== currentUserId);
    return teams;
  }, [filter, currentUserId, teams]);

  const pageCount = Math.max(1, Math.ceil(filteredTeams.length / TEAMS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedTeams = filteredTeams.slice(
    safePage * TEAMS_PER_PAGE,
    safePage * TEAMS_PER_PAGE + TEAMS_PER_PAGE,
  );

  const selectFilter = (next: TeamFilter) => {
    setFilter(next);
    setPage(0);
  };

  const filterCounts: Record<TeamFilter, number> = {
    all: teams.length,
    owned: ownedCount,
    joined: teams.length - ownedCount,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* Left: create + list */}
      <div className="space-y-5">
        {sharingLocked ? (
          <div className="flex flex-col gap-4 rounded-xl border border-dashed border-primary/20 bg-primary/[0.03] px-5 py-5">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-white/85">Upgrade to create teams</p>
              <p className="text-xs leading-relaxed text-white/45">
                Group collaborators and grant whole teams access at once. You can still join and
                leave teams you&rsquo;ve been invited to.
              </p>
            </div>
            <a
              href="/pricing"
              className="group/cta inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              Upgrade plan
              <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5" />
            </a>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = teamName.trim();
              if (!name) {
                toast.error("Enter a team name");
                return;
              }
              createTeamMutation.mutate({ name });
            }}
            className="rounded-2xl border border-white/[0.06] bg-card p-5"
          >
            <Label
              htmlFor="team-name"
              className="font-mono text-[11px] uppercase tracking-wider text-white/40"
            >
              New team
            </Label>
            <div className="mt-3 flex gap-2">
              <Input
                id="team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Engineering"
                maxLength={80}
              />
              <Button type="submit" disabled={createTeamMutation.isPending}>
                {createTeamMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {teams.length > 0 && (
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="font-mono text-[11px] uppercase tracking-wider text-white/40">
                Teams
              </span>
              <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-wider">
                {(["all", "owned", "joined"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectFilter(key)}
                    className={`transition-colors ${
                      filter === key ? "text-primary" : "text-white/30 hover:text-white/60"
                    }`}
                  >
                    {key}
                    <span className="ml-1 text-white/25">{filterCounts[key]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {teamsQuery.isLoading ? (
            <div className="h-16 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />
          ) : teams.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-8 text-center text-sm text-white/35">
              No teams yet. Create one to start grouping collaborators.
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-8 text-center text-sm text-white/35">
              {filter === "owned"
                ? "You haven't created any teams yet."
                : "You haven't joined any teams created by others."}
            </div>
          ) : (
            pagedTeams.map((team) => {
              const isActive = team.id === activeTeamId;
              const isOwner = team.creatorId === currentUserId;
              const isManager = !isOwner && team.role === "manager";
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => setActiveTeamId(team.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                    isActive
                      ? "border-primary/30 bg-primary/[0.06]"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
                  }`}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04]">
                    <UsersRound className="h-4 w-4 text-white/60" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white/85">{team.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">
                      Team
                    </p>
                  </div>
                  {isOwner ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                      <Crown className="h-2.5 w-2.5" />
                      Owner
                    </span>
                  ) : isManager ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/55">
                      Manager
                    </span>
                  ) : null}
                </button>
              );
            })
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-3 px-1 pt-1 font-mono text-[10px] uppercase tracking-wider text-white/40">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Previous page"
                className="rounded-md p-1 transition-colors hover:text-white/70 disabled:opacity-30 disabled:hover:text-white/40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage === pageCount - 1}
                aria-label="Next page"
                className="rounded-md p-1 transition-colors hover:text-white/70 disabled:opacity-30 disabled:hover:text-white/40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: detail */}
      <div>
        {activeTeamId ? (
          <TeamDetail
            teamId={activeTeamId}
            isOwner={teams.find((t) => t.id === activeTeamId)?.creatorId === currentUserId}
            onLeave={() => setActiveTeamId(null)}
          />
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <p className="max-w-xs text-sm text-white/35">
              Select a team to manage its members, or create a new one to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamDetail({
  teamId,
  isOwner,
  onLeave,
}: {
  teamId: string;
  isOwner: boolean;
  onLeave: () => void;
}) {
  const [email, setEmail] = useState("");

  const teamQuery = useQuery(trpc.workspaceShare.getTeam.queryOptions({ teamId }));

  const invalidateTeam = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.workspaceShare.getTeam.queryKey({ teamId }),
    });

  const leaveTeamMutation = useMutation(
    trpc.workspaceShare.leaveTeam.mutationOptions({
      onSuccess: async () => {
        toast.success("You left the team");
        onLeave();
        await queryClient.invalidateQueries({
          queryKey: trpc.workspaceShare.listTeams.queryKey(),
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const deleteTeamMutation = useMutation(
    trpc.workspaceShare.deleteTeam.mutationOptions({
      onSuccess: async () => {
        toast.success("Team deleted");
        onLeave();
        await queryClient.invalidateQueries({
          queryKey: trpc.workspaceShare.listTeams.queryKey(),
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const removeMemberMutation = useMutation(
    trpc.workspaceShare.removeTeamMember.mutationOptions({
      onSuccess: async () => {
        toast.success("Member removed");
        await invalidateTeam();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const inviteMutation = useMutation(
    trpc.workspaceShare.inviteTeamMember.mutationOptions({
      onSuccess: async (data) => {
        toast.success(`Invitation sent to ${data.invite.email}`);
        setEmail("");
        await copyInviteLink(data.inviteUrl);
        await invalidateTeam();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const cancelInviteMutation = useMutation(
    trpc.workspaceShare.cancelTeamInvite.mutationOptions({
      onSuccess: async () => {
        toast.success("Invitation cancelled");
        await invalidateTeam();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (teamQuery.isLoading) {
    return (
      <div className="h-[280px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
    );
  }

  const data = teamQuery.data;
  if (!data?.team) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-card p-6 text-sm text-white/40">
        Team not found.
      </div>
    );
  }

  const members = data.members ?? [];
  const invites = data.invites ?? [];

  return (
    <div className="space-y-6 rounded-2xl border border-white/[0.06] bg-card p-6">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-5">
        <div>
          <h2 className="font-display text-xl text-white">{data.team.name}</h2>
          <p className="mt-1 text-sm text-white/40">
            {members.length} member{members.length === 1 ? "" : "s"}
            {invites.length > 0 ? ` · ${invites.length} pending` : ""}
          </p>
        </div>
        {isOwner ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-border/50 hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            disabled={deleteTeamMutation.isPending}
            onClick={() => deleteTeamMutation.mutate({ teamId })}
          >
            {deleteTeamMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <X className="h-3.5 w-3.5" />
                Delete
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-border/50 hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            disabled={leaveTeamMutation.isPending}
            onClick={() => leaveTeamMutation.mutate({ teamId })}
          >
            {leaveTeamMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5" />
                Leave
              </>
            )}
          </Button>
        )}
      </div>

      {data.isManager && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = email.trim();
            if (!trimmed || !trimmed.includes("@")) {
              toast.error("Enter a valid email address");
              return;
            }
            inviteMutation.mutate({ teamId, email: trimmed });
          }}
          className="space-y-3"
        >
          <Label className="font-mono text-[11px] uppercase tracking-wider text-white/40">
            Invite a member
          </Label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1"
            />
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Invite
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] font-mono text-[11px] text-white/70">
                {(member.name || member.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-white/85">{member.name || member.email}</p>
                <p className="truncate text-xs text-white/35">{member.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {member.role === "manager" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                  <Crown className="h-2.5 w-2.5" />
                  Manager
                </span>
              )}
              {data.isManager && member.userId !== data.team.creatorId && (
                <button
                  type="button"
                  onClick={() => removeMemberMutation.mutate({ teamId, userId: member.userId })}
                  disabled={
                    removeMemberMutation.isPending &&
                    removeMemberMutation.variables?.userId === member.userId
                  }
                  aria-label="Remove member"
                  className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                >
                  {removeMemberMutation.isPending &&
                  removeMemberMutation.variables?.userId === member.userId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}

        {invites.map((invite) => (
          <div
            key={invite.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                <Mail className="h-3.5 w-3.5 text-white/50" />
              </div>
              <p className="truncate text-sm text-white/60">{invite.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                <Clock className="h-2.5 w-2.5" />
                Pending
              </span>
              {data.isManager && (
                <button
                  type="button"
                  onClick={() => cancelInviteMutation.mutate({ teamId, inviteId: invite.id })}
                  disabled={
                    cancelInviteMutation.isPending &&
                    cancelInviteMutation.variables?.inviteId === invite.id
                  }
                  aria-label="Cancel invitation"
                  className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                >
                  {cancelInviteMutation.isPending &&
                  cancelInviteMutation.variables?.inviteId === invite.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Clock,
  Link2,
  Loader2,
  Mail,
  Shield,
  Trash2,
  UsersRound,
} from "lucide-react";
import { trpc, queryClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ShareRole = "viewer" | "editor" | "admin";

const ROLE_LABELS: Record<ShareRole, string> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
};

function Avatar({ label }: { label: string }) {
  const initials = label.trim().slice(0, 2).toUpperCase() || "?";
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] font-mono text-[11px] font-medium text-white/70">
      {initials}
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
      <Shield className="h-2.5 w-2.5" />
      {ROLE_LABELS[role as ShareRole] ?? role}
    </span>
  );
}

export function ShareWorkspaceDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [teamRole, setTeamRole] = useState<ShareRole>("viewer");

  const shareQuery = useQuery({
    ...trpc.workspaceShare.list.queryOptions({ workspaceId }),
    enabled: open,
  });

  const teamsQuery = useQuery({
    ...trpc.workspaceShare.listTeams.queryOptions(),
    enabled: open,
  });

  const invalidateShare = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.workspaceShare.list.queryKey({ workspaceId }),
    });

  const inviteUserMutation = useMutation(
    trpc.workspaceShare.inviteUser.mutationOptions({
      onSuccess: async (data) => {
        toast.success(`Invitation sent to ${data.invite.email}`);
        setEmail("");
        await invalidateShare();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const removeUserMutation = useMutation(
    trpc.workspaceShare.removeUser.mutationOptions({
      onSuccess: async () => {
        toast.success("Access removed");
        await invalidateShare();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const cancelInviteMutation = useMutation(
    trpc.workspaceShare.cancelInvite.mutationOptions({
      onSuccess: async () => {
        toast.success("Invitation cancelled");
        await invalidateShare();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const addTeamMutation = useMutation(
    trpc.workspaceShare.addTeamToWorkspace.mutationOptions({
      onSuccess: async () => {
        toast.success("Team added to workspace");
        setSelectedTeamId("");
        await invalidateShare();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const removeTeamMutation = useMutation(
    trpc.workspaceShare.removeTeamFromWorkspace.mutationOptions({
      onSuccess: async () => {
        toast.success("Team removed");
        await invalidateShare();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const users = shareQuery.data?.users ?? [];
  const teamsWithAccess = shareQuery.data?.teams ?? [];
  const pendingInvites = useMemo(
    () =>
      (shareQuery.data?.invites ?? []).filter((i) => i.status === "pending"),
    [shareQuery.data?.invites],
  );

  const accessTeamIds = useMemo(
    () => new Set(teamsWithAccess.map((t) => t.teamId)),
    [teamsWithAccess],
  );
  const availableTeams = (teamsQuery.data?.teams ?? []).filter(
    (t) => !accessTeamIds.has(t.id),
  );

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    inviteUserMutation.mutate({ workspaceId, email: trimmed, role });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Share workspace
          </DialogTitle>
          <DialogDescription className="truncate text-muted-foreground">
            {workspaceName}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="people" className="mt-1 gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="people" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              People
            </TabsTrigger>
            <TabsTrigger value="teams" className="gap-1.5">
              <UsersRound className="h-3.5 w-3.5" />
              Teams
            </TabsTrigger>
          </TabsList>

          {/* People */}
          <TabsContent value="people" className="space-y-5">
            <form onSubmit={submitInvite} className="space-y-3">
              <Label
                htmlFor="invite-email"
                className="font-mono text-[11px] uppercase tracking-wider text-white/40"
              >
                Invite by email
              </Label>
              <div className="flex gap-2">
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="flex-1"
                />
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as ShareRole)}
                >
                  <SelectTrigger className="w-[110px]" size="default">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={inviteUserMutation.isPending}>
                  {inviteUserMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Invite"
                  )}
                </Button>
              </div>
            </form>

            <div className="space-y-2">
              {shareQuery.isLoading ? (
                <RowSkeleton />
              ) : (
                <>
                  {users.map((member) => (
                    <Row
                      key={member.id}
                      avatar={member.name || member.email}
                      title={member.name || member.email}
                      subtitle={member.email}
                      right={
                        <div className="flex items-center gap-2">
                          <RolePill role={member.role} />
                          <RowAction
                            pending={
                              removeUserMutation.isPending &&
                              removeUserMutation.variables?.userId ===
                                member.userId
                            }
                            onClick={() =>
                              removeUserMutation.mutate({
                                workspaceId,
                                userId: member.userId,
                              })
                            }
                            label="Remove access"
                          />
                        </div>
                      }
                    />
                  ))}

                  {pendingInvites.map((invite) => (
                    <Row
                      key={invite.id}
                      avatar={invite.email}
                      title={invite.email}
                      subtitle="Invitation pending"
                      muted
                      right={
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                            <Clock className="h-2.5 w-2.5" />
                            Pending
                          </span>
                          <RowAction
                            pending={
                              cancelInviteMutation.isPending &&
                              cancelInviteMutation.variables?.inviteId ===
                                invite.id
                            }
                            onClick={() =>
                              cancelInviteMutation.mutate({
                                workspaceId,
                                inviteId: invite.id,
                              })
                            }
                            label="Cancel invitation"
                          />
                        </div>
                      }
                    />
                  ))}

                  {users.length === 0 && pendingInvites.length === 0 && (
                    <EmptyState text="No collaborators yet. Invite someone by email." />
                  )}
                </>
              )}
            </div>
          </TabsContent>

          {/* Teams */}
          <TabsContent value="teams" className="space-y-5">
            <div className="space-y-3">
              <Label className="font-mono text-[11px] uppercase tracking-wider text-white/40">
                Give a team access
              </Label>
              {availableTeams.length === 0 ? (
                <p className="text-sm text-white/40">
                  No teams available.{" "}
                  <a
                    href="/dashboard/settings?section=teams"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Create a team
                  </a>{" "}
                  to share with a group.
                </p>
              ) : (
                <div className="flex gap-2">
                  <Select
                    value={selectedTeamId}
                    onValueChange={setSelectedTeamId}
                  >
                    <SelectTrigger className="flex-1" size="default">
                      <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTeams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={teamRole}
                    onValueChange={(v) => setTeamRole(v as ShareRole)}
                  >
                    <SelectTrigger className="w-[110px]" size="default">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={!selectedTeamId || addTeamMutation.isPending}
                    onClick={() =>
                      addTeamMutation.mutate({
                        workspaceId,
                        teamId: selectedTeamId,
                        role: teamRole,
                      })
                    }
                  >
                    {addTeamMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Add"
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {shareQuery.isLoading ? (
                <RowSkeleton />
              ) : teamsWithAccess.length === 0 ? (
                <EmptyState text="No teams have access to this workspace." />
              ) : (
                teamsWithAccess.map((team) => (
                  <Row
                    key={team.id}
                    icon={<UsersRound className="h-4 w-4 text-white/60" />}
                    title={team.name}
                    subtitle="Team"
                    right={
                      <div className="flex items-center gap-2">
                        <RolePill role={team.role} />
                        <RowAction
                          pending={
                            removeTeamMutation.isPending &&
                            removeTeamMutation.variables?.teamId === team.teamId
                          }
                          onClick={() =>
                            removeTeamMutation.mutate({
                              workspaceId,
                              teamId: team.teamId,
                            })
                          }
                          label="Remove team"
                        />
                      </div>
                    }
                  />
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  avatar,
  icon,
  title,
  subtitle,
  right,
  muted,
}: {
  avatar?: string;
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
            {icon}
          </div>
        ) : (
          <Avatar label={avatar ?? title} />
        )}
        <div className="min-w-0">
          <p
            className={`truncate text-sm ${muted ? "text-white/60" : "text-white/85"}`}
          >
            {title}
          </p>
          {subtitle ? (
            <p className="truncate text-xs text-white/35">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {right}
    </div>
  );
}

function RowAction({
  onClick,
  pending,
  label,
}: {
  onClick: () => void;
  pending: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function RowSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[58px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-sm text-white/35">
      {text}
    </div>
  );
}

"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock, GitBranch, Loader2, Terminal, UsersRound, X } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

type InviteType = "workspace" | "team";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background landing-grid dark">
      <header className="border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center px-6">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider text-white/90">
              GitTerm
            </span>
          </Link>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

function InviteCard({ children, eyebrow }: { children: React.ReactNode; eyebrow: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface-2 p-8 shadow-2xl">
      <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </p>
      {children}
    </div>
  );
}

function InviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";
  const type = (searchParams.get("type") as InviteType) ?? "workspace";

  const { data: session, isPending: sessionPending } = authClient.useSession();

  const inviteQuery = useQuery({
    ...trpc.workspaceShare.getInvite.queryOptions({ token, type }),
    enabled: token.length > 0,
    retry: false,
  });

  const acceptWorkspace = useMutation(
    trpc.workspaceShare.acceptWorkspaceInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invitation accepted");
        router.push("/dashboard/shared" as Route);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const declineWorkspace = useMutation(
    trpc.workspaceShare.declineWorkspaceInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invitation declined");
        router.push("/dashboard");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const acceptTeam = useMutation(
    trpc.workspaceShare.acceptTeamInvite.mutationOptions({
      onSuccess: () => {
        toast.success("You joined the team");
        router.push("/dashboard/settings?section=teams" as Route);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const declineTeam = useMutation(
    trpc.workspaceShare.declineTeamInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invitation declined");
        router.push("/dashboard");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  if (!token) {
    return (
      <Shell>
        <InviteCard eyebrow="Invitation">
          <h1 className="text-2xl text-white">Invalid link</h1>
          <p className="mt-2 text-sm text-white/40">
            This invitation link is missing required information.
          </p>
        </InviteCard>
      </Shell>
    );
  }

  if (inviteQuery.isLoading || sessionPending) {
    return (
      <Shell>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  const invite = inviteQuery.data?.invite;

  if (inviteQuery.error || !invite) {
    return (
      <Shell>
        <InviteCard eyebrow="Invitation">
          <h1 className="text-2xl text-white">Invitation not found</h1>
          <p className="mt-2 text-sm text-white/40">
            This invitation may have been revoked or already used.
          </p>
        </InviteCard>
      </Shell>
    );
  }

  const isExpired = new Date(invite.expiresAt) < new Date();
  const isResolved = invite.status !== "pending";
  const isTeam = type === "team";

  // Narrow the union for workspace-specific fields.
  const workspaceName = "workspaceName" in invite ? invite.workspaceName : null;
  const repositoryUrl = "repositoryUrl" in invite ? invite.repositoryUrl : null;
  const teamName = "teamName" in invite ? invite.teamName : null;
  const inviterName = "inviterName" in invite ? invite.inviterName : null;
  const inviterEmail = "inviterEmail" in invite ? invite.inviterEmail : null;

  const accept = () => {
    if (isTeam) acceptTeam.mutate({ token });
    else acceptWorkspace.mutate({ token });
  };
  const decline = () => {
    if (isTeam) declineTeam.mutate({ token });
    else declineWorkspace.mutate({ token });
  };

  const isAccepting = acceptTeam.isPending || acceptWorkspace.isPending;
  const isDeclining = declineWorkspace.isPending || declineTeam.isPending;

  if (isResolved) {
    return (
      <Shell>
        <InviteCard eyebrow={isTeam ? "Team invitation" : "Workspace invitation"}>
          <h1 className="text-2xl text-white">Invitation {invite.status}</h1>
          <p className="mt-2 text-sm text-white/40">
            This invitation has already been {invite.status}.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </InviteCard>
      </Shell>
    );
  }

  if (isExpired) {
    return (
      <Shell>
        <InviteCard eyebrow={isTeam ? "Team invitation" : "Workspace invitation"}>
          <h1 className="text-2xl text-white">Invitation expired</h1>
          <p className="mt-2 text-sm text-white/40">Ask the sender to invite you again.</p>
        </InviteCard>
      </Shell>
    );
  }

  const target = `/invite?token=${encodeURIComponent(token)}&type=${type}`;
  const isLoggedIn = !!session?.user;
  const emailMismatch =
    isLoggedIn && session.user.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <Shell>
      <InviteCard eyebrow={isTeam ? "Team invitation" : "Workspace invitation"}>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            {isTeam ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <GitBranch className="h-6 w-6 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl text-white">
              {isTeam ? teamName : (workspaceName ?? "A workspace")}
            </h1>
            <p className="text-sm text-white/40">
              {isTeam
                ? "You've been invited to join this team"
                : "You've been invited to collaborate"}
            </p>
          </div>
        </div>

        {inviterEmail ? (
          <p className="mb-5 text-sm text-white/50">
            Invited by{" "}
            <span className="font-medium text-white/85">{inviterName ?? inviterEmail}</span>
            {inviterName ? (
              <>
                {" "}
                <span className="text-white/35">({inviterEmail})</span>
              </>
            ) : null}
          </p>
        ) : null}

        {!isTeam && repositoryUrl ? (
          <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 font-mono text-xs text-white/50">
            {repositoryUrl.replace(/^https?:\/\//, "")}
          </div>
        ) : null}

        <p className="mb-6 inline-flex items-center gap-1.5 text-xs text-white/35">
          <Clock className="h-3 w-3" />
          Expires {new Date(invite.expiresAt).toLocaleDateString()}
        </p>

        {!isLoggedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-white/50">
              Sign in as <span className="font-medium text-white/80">{invite.email}</span> to
              respond to this invitation.
            </p>
            <Button asChild className="w-full">
              <Link href={`/login?redirect=${encodeURIComponent(target)}`}>
                Sign in to continue
              </Link>
            </Button>
          </div>
        ) : emailMismatch ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            This invitation was sent to <span className="font-medium">{invite.email}</span>, but
            you're signed in as <span className="font-medium">{session.user.email}</span>. Sign in
            with the invited account to accept.
          </div>
        ) : (
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-border/60"
              disabled={isAccepting || isDeclining}
              onClick={decline}
            >
              {isDeclining ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <X className="h-4 w-4" />
                  Decline
                </>
              )}
            </Button>
            <Button className="flex-1" disabled={isAccepting || isDeclining} onClick={accept}>
              {isAccepting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Accept
                </>
              )}
            </Button>
          </div>
        )}
      </InviteCard>
    </Shell>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Terminal className="h-8 w-8 animate-pulse text-primary" />
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}

import { createHash, randomBytes } from "crypto";
import z from "zod";
import { protectedProcedure, publicProcedure, router } from "../../index";
import { and, db, eq, gt, inArray, ne, or } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { workspace } from "@gitterm/db/schema/workspace";
import {
  workspaceShareInvite,
  workspaceShareTeam,
  workspaceShareTeamInvite,
  workspaceShareTeamMember,
  workspaceTeamAccess,
  workspaceUserAccess,
} from "@gitterm/db/schema/workspace-access";
import { TRPCError } from "@trpc/server";
import {
  buildInviteUrl,
  renderTeamInviteEmail,
  renderWorkspaceInviteEmail,
} from "../../service/email/invite-templates";
import { sendEmail } from "../../service/email/mailer";
import { decryptWorkspacePassword } from "../../utils/workspace-password";
import { canShareWorkspaces, type UserPlan } from "../../config";

const roleSchema = z.enum(["viewer", "editor", "admin"]);
const INVITE_TTL_DAYS = 7;
const MAX_COLLABORATORS = 10;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Sharing (inviting collaborators, creating teams, granting team access) is a
 * paid feature (Starter and Pro). Only the "granting" side is gated here -
 * accepting an invite, listing/leaving shared workspaces, and revoking access
 * are always allowed so free recipients keep working and downgraded owners can
 * still clean up.
 */
function requireSharingEntitlement(plan: UserPlan | string | null | undefined) {
  if (!canShareWorkspaces(plan ?? "free")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Sharing workspaces requires a paid plan. Upgrade to Starter or Pro to invite collaborators and create teams.",
    });
  }
}

function createInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function inviteExpiresAt() {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Sends an invite email without failing the mutation. The invite link is also
 * returned to the caller (copy-to-clipboard), so delivery is best-effort and a
 * provider outage must not orphan the already-persisted invite row.
 */
async function sendInviteEmailSafe(message: Parameters<typeof sendEmail>[0]) {
  try {
    await sendEmail(message);
  } catch (error) {
    console.error(`[share] Failed to send invite email to ${message.to}:`, error);
  }
}

/**
 * Strips inviter/workspace PII from an invite once it is no longer actionable
 * (resolved or expired). `getInvite` is public, so only live invites expose
 * details needed to render the accept screen.
 */
function redactResolvedInvite<
  T extends { email: string; status: string; expiresAt: Date },
>(invite: T | undefined): T | undefined {
  if (!invite) return invite;
  const expired = invite.expiresAt < new Date();
  if (invite.status === "pending" && !expired) return invite;
  return {
    email: invite.email,
    status: invite.status,
    expiresAt: invite.expiresAt,
  } as T;
}

async function requireOwnedWorkspace(workspaceId: string, userId: string) {
  const [record] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, userId)))
    .limit(1);

  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }

  return record;
}

async function requireManagedTeam(teamId: string, userId: string) {
  const [team] = await db
    .select({
      id: workspaceShareTeam.id,
      name: workspaceShareTeam.name,
      creatorId: workspaceShareTeam.creatorId,
    })
    .from(workspaceShareTeam)
    .leftJoin(
      workspaceShareTeamMember,
      and(
        eq(workspaceShareTeamMember.teamId, workspaceShareTeam.id),
        eq(workspaceShareTeamMember.userId, userId),
        eq(workspaceShareTeamMember.role, "manager"),
      ),
    )
    .where(
      and(
        eq(workspaceShareTeam.id, teamId),
        or(
          eq(workspaceShareTeam.creatorId, userId),
          eq(workspaceShareTeamMember.userId, userId),
        ),
      ),
    )
    .limit(1);

  if (!team) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
  }

  return team;
}

async function getWorkspaceCollaboratorCount(workspaceId: string, extraUserIds: string[] = []) {
  const now = new Date();
  const [directRows, teamRows, pendingRows] = await Promise.all([
    db
      .select({ userId: workspaceUserAccess.userId })
      .from(workspaceUserAccess)
      .where(eq(workspaceUserAccess.workspaceId, workspaceId)),
    db
      .select({ userId: workspaceShareTeamMember.userId })
      .from(workspaceTeamAccess)
      .innerJoin(
        workspaceShareTeamMember,
        eq(workspaceShareTeamMember.teamId, workspaceTeamAccess.teamId),
      )
      .where(eq(workspaceTeamAccess.workspaceId, workspaceId)),
    db
      .select({ email: workspaceShareInvite.email })
      .from(workspaceShareInvite)
      .where(
        and(
          eq(workspaceShareInvite.workspaceId, workspaceId),
          eq(workspaceShareInvite.status, "pending"),
          gt(workspaceShareInvite.expiresAt, now),
        ),
      ),
  ]);

  return new Set([
    ...directRows.map((row) => row.userId),
    ...teamRows.map((row) => row.userId),
    ...pendingRows.map((row) => `invite:${normalizeEmail(row.email)}`),
    ...extraUserIds,
  ]).size;
}

async function assertWorkspaceCollaboratorCapacity(workspaceId: string, extraUserIds: string[] = []) {
  const count = await getWorkspaceCollaboratorCount(workspaceId, extraUserIds);
  if (count > MAX_COLLABORATORS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This workspace has reached the limit of ${MAX_COLLABORATORS} collaborators`,
    });
  }
}

export const workspaceShareRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      await requireOwnedWorkspace(input.workspaceId, ctx.session.user.id);

      const [users, teams, invites] = await Promise.all([
        db
          .select({
            id: workspaceUserAccess.id,
            userId: workspaceUserAccess.userId,
            role: workspaceUserAccess.role,
            email: user.email,
            name: user.name,
            createdAt: workspaceUserAccess.createdAt,
          })
          .from(workspaceUserAccess)
          .innerJoin(user, eq(user.id, workspaceUserAccess.userId))
          .where(eq(workspaceUserAccess.workspaceId, input.workspaceId)),
        db
          .select({
            id: workspaceTeamAccess.id,
            teamId: workspaceTeamAccess.teamId,
            role: workspaceTeamAccess.role,
            name: workspaceShareTeam.name,
            createdAt: workspaceTeamAccess.createdAt,
          })
          .from(workspaceTeamAccess)
          .innerJoin(workspaceShareTeam, eq(workspaceShareTeam.id, workspaceTeamAccess.teamId))
          .where(eq(workspaceTeamAccess.workspaceId, input.workspaceId)),
        db
          .select({
            id: workspaceShareInvite.id,
            email: workspaceShareInvite.email,
            role: workspaceShareInvite.role,
            status: workspaceShareInvite.status,
            expiresAt: workspaceShareInvite.expiresAt,
            createdAt: workspaceShareInvite.createdAt,
          })
          .from(workspaceShareInvite)
          .where(
            and(
              eq(workspaceShareInvite.workspaceId, input.workspaceId),
              eq(workspaceShareInvite.status, "pending"),
              gt(workspaceShareInvite.expiresAt, new Date()),
            ),
          ),
      ]);

      return { success: true, users, teams, invites };
    }),

  inviteUser: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        email: z.email(),
        role: roleSchema.default("viewer"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireSharingEntitlement(ctx.session.user.plan);
      const inviterId = ctx.session.user.id;
      const email = normalizeEmail(input.email);
      const ownerWorkspace = await requireOwnedWorkspace(input.workspaceId, inviterId);

      if (email === normalizeEmail(ctx.session.user.email)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot invite yourself" });
      }

      const [targetUser] = await db.select().from(user).where(eq(user.email, email)).limit(1);

      if (targetUser?.id === ownerWorkspace.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace owner already has access" });
      }

      // Cap direct collaborators (accepted access + outstanding pending invites).
      // Re-inviting an existing collaborator/invitee is always allowed.
      const alreadyInvolved =
        (targetUser
          ? await db.$count(
              workspaceUserAccess,
              and(
                eq(workspaceUserAccess.workspaceId, input.workspaceId),
                eq(workspaceUserAccess.userId, targetUser.id),
              ),
            )
          : 0) > 0 ||
        (await db.$count(
          workspaceShareInvite,
          and(
            eq(workspaceShareInvite.workspaceId, input.workspaceId),
            eq(workspaceShareInvite.email, email),
            eq(workspaceShareInvite.status, "pending"),
          ),
        )) > 0;

      if (!alreadyInvolved) {
        const collaboratorCount = await getWorkspaceCollaboratorCount(input.workspaceId);
        if (collaboratorCount >= MAX_COLLABORATORS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This workspace has reached the limit of ${MAX_COLLABORATORS} collaborators`,
          });
        }
      }

      const { token, tokenHash } = createInviteToken();
      const acceptUrl = buildInviteUrl({ token, type: "workspace" });
      const [invite] = await db
        .insert(workspaceShareInvite)
        .values({
          workspaceId: input.workspaceId,
          inviterId,
          invitedUserId: targetUser?.id,
          email,
          role: input.role,
          tokenHash,
          expiresAt: inviteExpiresAt(),
        })
        .onConflictDoUpdate({
          target: [workspaceShareInvite.workspaceId, workspaceShareInvite.email],
          set: {
            inviterId,
            invitedUserId: targetUser?.id,
            role: input.role,
            tokenHash,
            status: "pending",
            expiresAt: inviteExpiresAt(),
            acceptedAt: null,
            declinedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create invite",
        });
      }

      const emailContent = await renderWorkspaceInviteEmail({
        inviterName: ctx.session.user.name,
        inviterEmail: ctx.session.user.email,
        workspaceName: ownerWorkspace.name ?? "a workspace",
        repositoryUrl: ownerWorkspace.repositoryUrl,
        role: input.role,
        acceptUrl,
        expiresAt: invite.expiresAt,
      });
      await sendInviteEmailSafe({ to: email, ...emailContent });

      return { success: true, invite, inviteUrl: acceptUrl };
    }),

  acceptWorkspaceInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16) }))
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashInviteToken(input.token);
      const email = normalizeEmail(ctx.session.user.email);

      const [invite] = await db
        .select()
        .from(workspaceShareInvite)
        .where(eq(workspaceShareInvite.tokenHash, tokenHash))
        .limit(1);

      if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or expired" });
      }

      if (normalizeEmail(invite.email) !== email) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match your account" });
      }

      await db.transaction(async (tx) => {
        await tx
          .insert(workspaceUserAccess)
          .values({
            workspaceId: invite.workspaceId,
            userId: ctx.session.user.id,
            role: invite.role,
            grantedByUserId: invite.inviterId,
          })
          .onConflictDoUpdate({
            target: [workspaceUserAccess.workspaceId, workspaceUserAccess.userId],
            set: { role: invite.role, updatedAt: new Date() },
          });

        await tx
          .update(workspaceShareInvite)
          .set({
            status: "accepted",
            invitedUserId: ctx.session.user.id,
            acceptedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(workspaceShareInvite.id, invite.id));
      });

      return { success: true, workspaceId: invite.workspaceId };
    }),

  declineWorkspaceInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16) }))
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashInviteToken(input.token);
      const email = normalizeEmail(ctx.session.user.email);

      const [invite] = await db
        .select()
        .from(workspaceShareInvite)
        .where(eq(workspaceShareInvite.tokenHash, tokenHash))
        .limit(1);

      if (!invite || invite.status !== "pending") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      if (normalizeEmail(invite.email) !== email) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match your account" });
      }

      await db
        .update(workspaceShareInvite)
        .set({ status: "declined", declinedAt: new Date(), updatedAt: new Date() })
        .where(eq(workspaceShareInvite.id, invite.id));

      return { success: true };
    }),

  getInvite: publicProcedure
    .input(z.object({ token: z.string().min(16), type: z.enum(["workspace", "team"]) }))
    .query(async ({ input }) => {
      const tokenHash = hashInviteToken(input.token);

      if (input.type === "team") {
        const [invite] = await db
          .select({
            id: workspaceShareTeamInvite.id,
            email: workspaceShareTeamInvite.email,
            status: workspaceShareTeamInvite.status,
            expiresAt: workspaceShareTeamInvite.expiresAt,
            teamName: workspaceShareTeam.name,
            inviterName: user.name,
            inviterEmail: user.email,
          })
          .from(workspaceShareTeamInvite)
          .innerJoin(workspaceShareTeam, eq(workspaceShareTeam.id, workspaceShareTeamInvite.teamId))
          .innerJoin(user, eq(user.id, workspaceShareTeamInvite.inviterId))
          .where(eq(workspaceShareTeamInvite.tokenHash, tokenHash))
          .limit(1);

        return { success: true, invite: redactResolvedInvite(invite) };
      }

      const [invite] = await db
        .select({
          id: workspaceShareInvite.id,
          email: workspaceShareInvite.email,
          role: workspaceShareInvite.role,
          status: workspaceShareInvite.status,
          expiresAt: workspaceShareInvite.expiresAt,
          workspaceName: workspace.name,
          repositoryUrl: workspace.repositoryUrl,
          inviterName: user.name,
          inviterEmail: user.email,
        })
        .from(workspaceShareInvite)
        .innerJoin(workspace, eq(workspace.id, workspaceShareInvite.workspaceId))
        .innerJoin(user, eq(user.id, workspaceShareInvite.inviterId))
        .where(eq(workspaceShareInvite.tokenHash, tokenHash))
        .limit(1);

      return { success: true, invite: redactResolvedInvite(invite) };
    }),

  removeUser: protectedProcedure
    .input(z.object({ workspaceId: z.uuid(), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedWorkspace(input.workspaceId, ctx.session.user.id);
      const removed = await db
        .delete(workspaceUserAccess)
        .where(
          and(
            eq(workspaceUserAccess.workspaceId, input.workspaceId),
            eq(workspaceUserAccess.userId, input.userId),
          ),
        )
        .returning({ id: workspaceUserAccess.id });

      if (removed.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No direct access to remove. This user may have access via a team \u2014 remove the team instead.",
        });
      }
      return { success: true };
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        userId: z.string().min(1),
        role: roleSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireOwnedWorkspace(input.workspaceId, ctx.session.user.id);
      const updated = await db
        .update(workspaceUserAccess)
        .set({ role: input.role, updatedAt: new Date() })
        .where(
          and(
            eq(workspaceUserAccess.workspaceId, input.workspaceId),
            eq(workspaceUserAccess.userId, input.userId),
          ),
        )
        .returning({ id: workspaceUserAccess.id });

      if (updated.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This user does not have direct access to the workspace",
        });
      }
      return { success: true };
    }),

  leaveSharedWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [access] = await db
        .select({ id: workspaceUserAccess.id })
        .from(workspaceUserAccess)
        .where(
          and(
            eq(workspaceUserAccess.workspaceId, input.workspaceId),
            eq(workspaceUserAccess.userId, userId),
          ),
        )
        .limit(1);

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You don't have direct access to this workspace",
        });
      }

      await db
        .delete(workspaceUserAccess)
        .where(
          and(
            eq(workspaceUserAccess.workspaceId, input.workspaceId),
            eq(workspaceUserAccess.userId, userId),
          ),
        );
      return { success: true };
    }),

  cancelInvite: protectedProcedure
    .input(z.object({ workspaceId: z.uuid(), inviteId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedWorkspace(input.workspaceId, ctx.session.user.id);
      await db
        .update(workspaceShareInvite)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(workspaceShareInvite.id, input.inviteId),
            eq(workspaceShareInvite.workspaceId, input.workspaceId),
            eq(workspaceShareInvite.status, "pending"),
          ),
        );
      return { success: true };
    }),

  createTeam: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ input, ctx }) => {
      requireSharingEntitlement(ctx.session.user.plan);
      const [team] = await db
        .insert(workspaceShareTeam)
        .values({ creatorId: ctx.session.user.id, name: input.name })
        .returning();

      if (!team) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create team",
        });
      }

      await db.insert(workspaceShareTeamMember).values({
        teamId: team.id,
        userId: ctx.session.user.id,
        role: "manager",
      });

      return { success: true, team };
    }),

  listTeams: protectedProcedure.query(async ({ ctx }) => {
    const teams = await db
      .select({
        id: workspaceShareTeam.id,
        name: workspaceShareTeam.name,
        creatorId: workspaceShareTeam.creatorId,
        createdAt: workspaceShareTeam.createdAt,
        role: workspaceShareTeamMember.role,
      })
      .from(workspaceShareTeam)
      .innerJoin(workspaceShareTeamMember, eq(workspaceShareTeamMember.teamId, workspaceShareTeam.id))
      .where(eq(workspaceShareTeamMember.userId, ctx.session.user.id));

    return { success: true, teams };
  }),

  leaveTeam: protectedProcedure
    .input(z.object({ teamId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [team] = await db
        .select({ creatorId: workspaceShareTeam.creatorId })
        .from(workspaceShareTeam)
        .where(eq(workspaceShareTeam.id, input.teamId))
        .limit(1);

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      if (team.creatorId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Team creators cannot leave their own team; delete the team instead",
        });
      }

      const removed = await db
        .delete(workspaceShareTeamMember)
        .where(
          and(
            eq(workspaceShareTeamMember.teamId, input.teamId),
            eq(workspaceShareTeamMember.userId, userId),
          ),
        )
        .returning({ id: workspaceShareTeamMember.id });

      if (removed.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are not a member of this team",
        });
      }
      return { success: true };
    }),

  deleteTeam: protectedProcedure
    .input(z.object({ teamId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await db
        .delete(workspaceShareTeam)
        .where(
          and(
            eq(workspaceShareTeam.id, input.teamId),
            eq(workspaceShareTeam.creatorId, ctx.session.user.id),
          ),
        )
        .returning({ id: workspaceShareTeam.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }
      return { success: true };
    }),

  removeTeamMember: protectedProcedure
    .input(z.object({ teamId: z.uuid(), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const team = await requireManagedTeam(input.teamId, ctx.session.user.id);
      if (input.userId === team.creatorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Team creator cannot be removed" });
      }

      const removed = await db
        .delete(workspaceShareTeamMember)
        .where(
          and(
            eq(workspaceShareTeamMember.teamId, input.teamId),
            eq(workspaceShareTeamMember.userId, input.userId),
          ),
        )
        .returning({ id: workspaceShareTeamMember.id });

      if (removed.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });
      }
      return { success: true };
    }),

  getTeam: protectedProcedure
    .input(z.object({ teamId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const [membership] = await db
        .select({ role: workspaceShareTeamMember.role })
        .from(workspaceShareTeamMember)
        .where(
          and(
            eq(workspaceShareTeamMember.teamId, input.teamId),
            eq(workspaceShareTeamMember.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
      }

      const [team] = await db
        .select()
        .from(workspaceShareTeam)
        .where(eq(workspaceShareTeam.id, input.teamId))
        .limit(1);

      const isManager =
        membership.role === "manager" || team?.creatorId === ctx.session.user.id;

      const [members, invites] = await Promise.all([
        db
          .select({
            id: workspaceShareTeamMember.id,
            userId: workspaceShareTeamMember.userId,
            role: workspaceShareTeamMember.role,
            name: user.name,
            email: user.email,
            createdAt: workspaceShareTeamMember.createdAt,
          })
          .from(workspaceShareTeamMember)
          .innerJoin(user, eq(user.id, workspaceShareTeamMember.userId))
          .where(eq(workspaceShareTeamMember.teamId, input.teamId)),
        db
          .select()
          .from(workspaceShareTeamInvite)
          .where(
            and(
              eq(workspaceShareTeamInvite.teamId, input.teamId),
              eq(workspaceShareTeamInvite.status, "pending"),
            ),
          ),
      ]);

      return { success: true, team, members, invites, isManager };
    }),

  inviteTeamMember: protectedProcedure
    .input(z.object({ teamId: z.uuid(), email: z.email() }))
    .mutation(async ({ input, ctx }) => {
      requireSharingEntitlement(ctx.session.user.plan);
      const team = await requireManagedTeam(input.teamId, ctx.session.user.id);
      const email = normalizeEmail(input.email);
      const [targetUser] = await db.select().from(user).where(eq(user.email, email)).limit(1);
      const { token, tokenHash } = createInviteToken();
      const acceptUrl = buildInviteUrl({ token, type: "team" });

      if (targetUser) {
        const attachedWorkspaces = await db
          .select({ workspaceId: workspaceTeamAccess.workspaceId })
          .from(workspaceTeamAccess)
          .where(eq(workspaceTeamAccess.teamId, input.teamId));
        await Promise.all(
          attachedWorkspaces.map((row) =>
            assertWorkspaceCollaboratorCapacity(row.workspaceId, [targetUser.id]),
          ),
        );
      }

      const [invite] = await db
        .insert(workspaceShareTeamInvite)
        .values({
          teamId: input.teamId,
          inviterId: ctx.session.user.id,
          invitedUserId: targetUser?.id,
          email,
          tokenHash,
          expiresAt: inviteExpiresAt(),
        })
        .onConflictDoUpdate({
          target: [workspaceShareTeamInvite.teamId, workspaceShareTeamInvite.email],
          set: {
            inviterId: ctx.session.user.id,
            invitedUserId: targetUser?.id,
            tokenHash,
            status: "pending",
            expiresAt: inviteExpiresAt(),
            acceptedAt: null,
            declinedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create invite",
        });
      }

      const emailContent = await renderTeamInviteEmail({
        inviterName: ctx.session.user.name,
        inviterEmail: ctx.session.user.email,
        teamName: team.name,
        acceptUrl,
        expiresAt: invite.expiresAt,
      });
      await sendInviteEmailSafe({ to: email, ...emailContent });

      return { success: true, invite, inviteUrl: acceptUrl };
    }),

  acceptTeamInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16) }))
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashInviteToken(input.token);
      const email = normalizeEmail(ctx.session.user.email);
      const [invite] = await db
        .select()
        .from(workspaceShareTeamInvite)
        .where(eq(workspaceShareTeamInvite.tokenHash, tokenHash))
        .limit(1);

      if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or expired" });
      }

      if (normalizeEmail(invite.email) !== email) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match your account" });
      }

      const attachedWorkspaces = await db
        .select({ workspaceId: workspaceTeamAccess.workspaceId })
        .from(workspaceTeamAccess)
        .where(eq(workspaceTeamAccess.teamId, invite.teamId));
      await Promise.all(
        attachedWorkspaces.map((row) =>
          assertWorkspaceCollaboratorCapacity(row.workspaceId, [ctx.session.user.id]),
        ),
      );

      await db.transaction(async (tx) => {
        await tx
          .insert(workspaceShareTeamMember)
          .values({ teamId: invite.teamId, userId: ctx.session.user.id })
          .onConflictDoNothing({
            target: [workspaceShareTeamMember.teamId, workspaceShareTeamMember.userId],
          });

        await tx
          .update(workspaceShareTeamInvite)
          .set({
            status: "accepted",
            invitedUserId: ctx.session.user.id,
            acceptedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(workspaceShareTeamInvite.id, invite.id));
      });

      return { success: true, teamId: invite.teamId };
    }),

  declineTeamInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16) }))
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashInviteToken(input.token);
      const email = normalizeEmail(ctx.session.user.email);
      const [invite] = await db
        .select()
        .from(workspaceShareTeamInvite)
        .where(eq(workspaceShareTeamInvite.tokenHash, tokenHash))
        .limit(1);

      if (!invite || invite.status !== "pending") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      if (normalizeEmail(invite.email) !== email) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match your account" });
      }

      await db
        .update(workspaceShareTeamInvite)
        .set({ status: "declined", declinedAt: new Date(), updatedAt: new Date() })
        .where(eq(workspaceShareTeamInvite.id, invite.id));

      return { success: true };
    }),

  cancelTeamInvite: protectedProcedure
    .input(z.object({ teamId: z.uuid(), inviteId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireManagedTeam(input.teamId, ctx.session.user.id);
      await db
        .update(workspaceShareTeamInvite)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(workspaceShareTeamInvite.id, input.inviteId),
            eq(workspaceShareTeamInvite.teamId, input.teamId),
            eq(workspaceShareTeamInvite.status, "pending"),
          ),
        );
      return { success: true };
    }),

  addTeamToWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.uuid(), teamId: z.uuid(), role: roleSchema.default("viewer") }))
    .mutation(async ({ input, ctx }) => {
      requireSharingEntitlement(ctx.session.user.plan);
      await requireOwnedWorkspace(input.workspaceId, ctx.session.user.id);
      await requireManagedTeam(input.teamId, ctx.session.user.id);

      const memberRows = await db
        .select({ userId: workspaceShareTeamMember.userId })
        .from(workspaceShareTeamMember)
        .where(eq(workspaceShareTeamMember.teamId, input.teamId));
      await assertWorkspaceCollaboratorCapacity(
        input.workspaceId,
        memberRows.map((row) => row.userId),
      );

      const [access] = await db
        .insert(workspaceTeamAccess)
        .values({
          workspaceId: input.workspaceId,
          teamId: input.teamId,
          role: input.role,
          grantedByUserId: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: [workspaceTeamAccess.workspaceId, workspaceTeamAccess.teamId],
          set: { role: input.role, updatedAt: new Date() },
        })
        .returning();

      return { success: true, access };
    }),

  removeTeamFromWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.uuid(), teamId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedWorkspace(input.workspaceId, ctx.session.user.id);
      await db
        .delete(workspaceTeamAccess)
        .where(
          and(
            eq(workspaceTeamAccess.workspaceId, input.workspaceId),
            eq(workspaceTeamAccess.teamId, input.teamId),
          ),
        );
      return { success: true };
    }),

  listSharedWorkspaces: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const directRows = await db
      .select({
        workspaceId: workspaceUserAccess.workspaceId,
        role: workspaceUserAccess.role,
      })
      .from(workspaceUserAccess)
      .where(eq(workspaceUserAccess.userId, userId));

    const teamRows = await db
      .select({
        workspaceId: workspaceTeamAccess.workspaceId,
        role: workspaceTeamAccess.role,
        teamName: workspaceShareTeam.name,
      })
      .from(workspaceShareTeamMember)
      .innerJoin(
        workspaceTeamAccess,
        eq(workspaceTeamAccess.teamId, workspaceShareTeamMember.teamId),
      )
      .innerJoin(
        workspaceShareTeam,
        eq(workspaceShareTeam.id, workspaceShareTeamMember.teamId),
      )
      .where(eq(workspaceShareTeamMember.userId, userId));

    // Resolve access context per workspace; direct access wins over team access.
    const access = new Map<
      string,
      { role: string; via: { kind: "user" } | { kind: "team"; teamName: string } }
    >();
    for (const row of teamRows) {
      access.set(row.workspaceId, {
        role: row.role,
        via: { kind: "team", teamName: row.teamName },
      });
    }
    for (const row of directRows) {
      access.set(row.workspaceId, { role: row.role, via: { kind: "user" } });
    }

    const ids = [...access.keys()];
    if (ids.length === 0) {
      return { success: true, workspaces: [] };
    }

    const rows = await db.query.workspace.findMany({
      where: and(
        inArray(workspace.id, ids),
        ne(workspace.status, "terminated"),
      ),
      with: { image: { with: { agentType: true } } },
      orderBy: (workspace, { desc }) => [desc(workspace.startedAt)],
    });

    // Resolve workspace owners (who created/shared the workspace).
    const ownerIds = [...new Set(rows.map((ws) => ws.userId))];
    const owners = ownerIds.length
      ? await db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(inArray(user.id, ownerIds))
      : [];
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    const workspaces = rows.map((ws) => {
      const ctx = access.get(ws.id)!;
      const owner = ownerById.get(ws.userId) ?? null;
      const serverPassword =
        ws.serverPassword && ws.serverOnly
          ? safeDecryptPassword(ws.serverPassword, ws.id)
          : ws.serverPassword;
      return { ...ws, serverPassword, access: { ...ctx, owner } };
    });

    return { success: true, workspaces };
  }),
});

function safeDecryptPassword(value: string, workspaceId: string): string | null {
  try {
    return decryptWorkspacePassword(value);
  } catch (error) {
    console.error(`Failed to decrypt password for workspace ${workspaceId}:`, error);
    return null;
  }
}

export async function userCanAccessWorkspace(workspaceId: string, userId: string) {
  const [record] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .leftJoin(
      workspaceUserAccess,
      and(eq(workspaceUserAccess.workspaceId, workspace.id), eq(workspaceUserAccess.userId, userId)),
    )
    .leftJoin(workspaceTeamAccess, eq(workspaceTeamAccess.workspaceId, workspace.id))
    .leftJoin(
      workspaceShareTeamMember,
      and(
        eq(workspaceShareTeamMember.teamId, workspaceTeamAccess.teamId),
        eq(workspaceShareTeamMember.userId, userId),
      ),
    )
    .where(
      and(
        eq(workspace.id, workspaceId),
        or(
          eq(workspace.userId, userId),
          eq(workspaceUserAccess.userId, userId),
          eq(workspaceShareTeamMember.userId, userId),
        ),
      ),
    )
    .limit(1);

  return Boolean(record);
}

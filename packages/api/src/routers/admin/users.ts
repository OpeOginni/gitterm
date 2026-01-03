/**
 * Admin Users Router
 * 
 * Manages users - view, create, update plans/roles, delete.
 */

import { z } from "zod";
import { adminProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { db, eq, sql, desc, asc } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { workspace, usageSession } from "@gitterm/db/schema/workspace";
import { isGitHubAuthEnabled, isEmailAuthEnabled } from "@gitterm/env/server";
import { auth } from "@gitterm/auth";

// ============================================================================
// Input Schemas
// ============================================================================

const listUsersSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "email", "name"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const updateUserSchema = z.object({
  id: z.string().min(1),
  plan: z.enum(["free", "tunnel", "pro"]).optional(),
  role: z.enum(["user", "admin"]).optional(),
});

const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  role: z.enum(["user", "admin"]).default("user"),
  plan: z.enum(["free", "tunnel", "pro"]).default("free"),
});

// ============================================================================
// Router
// ============================================================================

export const usersRouter = router({
  /**
   * List all users with pagination and search
   */
  list: adminProcedure
    .input(listUsersSchema)
    .query(async ({ input }) => {
      const { limit, offset, search, sortBy, sortOrder } = input;
      
      // Build base query
      let query = db.select().from(user);
      
      // Apply search filter if provided
      if (search) {
        query = query.where(
          sql`${user.email} ILIKE ${'%' + search + '%'} OR ${user.name} ILIKE ${'%' + search + '%'}`
        ) as typeof query;
      }
      
      // Apply sorting
      const sortFn = sortOrder === "asc" ? asc : desc;
      const sortColumn = sortBy === "email" ? user.email : sortBy === "name" ? user.name : user.createdAt;
      
      const users = await query
        .orderBy(sortFn(sortColumn))
        .limit(limit)
        .offset(offset);
      
      // Get total count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(user);
      
      return {
        users,
        total: Number(countResult?.count ?? 0),
        limit,
        offset,
      };
    }),

  /**
   * Create a new user (only available when email-only auth is enabled)
   * 
   * This endpoint is restricted to email-only auth mode because:
   * - When GitHub OAuth is enabled, users should sign up via OAuth
   * - Creating users manually bypasses OAuth flow and could cause confusion
   */
  create: adminProcedure
    .input(createUserSchema)
    .mutation(async ({ input }) => {
      // Check if user creation is allowed
      if (!isEmailAuthEnabled()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Email authentication is not enabled",
        });
      }
      
      if (isGitHubAuthEnabled()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User creation is not available when GitHub authentication is enabled. Users should sign up via GitHub.",
        });
      }
      
      const { email, password, name, role, plan } = input;
      
      // Check if user already exists
      const [existingUser] = await db
        .select()
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists",
        });
      }
      
      // Create user using better-auth's signup (handles password hashing)
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });
      
      if (!result.user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }
      
      // Update user with role, plan, and auto-verify email
      const [createdUser] = await db
        .update(user)
        .set({
          role,
          plan,
          emailVerified: true, // Auto-verify admin-created users
          updatedAt: new Date(),
        })
        .where(eq(user.id, result.user.id))
        .returning();
      
      return createdUser;
    }),

  /**
   * Get a single user by ID with their workspaces
   */
  get: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const [foundUser] = await db
        .select()
        .from(user)
        .where(eq(user.id, input.id));
      
      if (!foundUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      
      // Get user's workspaces
      const workspaces = await db
        .select()
        .from(workspace)
        .where(eq(workspace.userId, input.id));
      
      // Get usage stats
      const [usageStats] = await db
        .select({
          totalSessions: sql<number>`count(*)`,
          totalMinutes: sql<number>`COALESCE(SUM(${usageSession.durationMinutes}), 0)`,
        })
        .from(usageSession)
        .where(eq(usageSession.userId, input.id));
      
      return {
        ...foundUser,
        workspaces,
        stats: {
          workspaceCount: workspaces.length,
          totalSessions: Number(usageStats?.totalSessions ?? 0),
          totalMinutes: Number(usageStats?.totalMinutes ?? 0),
        },
      };
    }),

  /**
   * Update user plan or role
   */
  update: adminProcedure
    .input(updateUserSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      
      // Don't allow admin to remove their own admin role
      if (updates.role === "user" && ctx.session.user.id === id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove your own admin role",
        });
      }
      
      const [updated] = await db
        .update(user)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(user.id, id))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      
      return updated;
    }),

  /**
   * Delete a user (admin cannot delete themselves)
   */
  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      // Don't allow admin to delete themselves
      if (ctx.session.user.id === input.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete your own account via admin panel",
        });
      }
      
      const [deleted] = await db
        .delete(user)
        .where(eq(user.id, input.id))
        .returning();
      
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      
      return { success: true };
    }),

  /**
   * Get dashboard stats
   */
  stats: adminProcedure.query(async () => {
    const [userStats] = await db
      .select({
        total: sql<number>`count(*)`,
        admins: sql<number>`count(*) FILTER (WHERE ${user.role} = 'admin')`,
        freeUsers: sql<number>`count(*) FILTER (WHERE ${user.plan} = 'free')`,
        paidUsers: sql<number>`count(*) FILTER (WHERE ${user.plan} != 'free')`,
      })
      .from(user);
    
    const [workspaceStats] = await db
      .select({
        total: sql<number>`count(*)`,
        running: sql<number>`count(*) FILTER (WHERE ${workspace.status} = 'running')`,
        stopped: sql<number>`count(*) FILTER (WHERE ${workspace.status} = 'stopped')`,
      })
      .from(workspace);
    
    return {
      users: {
        total: Number(userStats?.total ?? 0),
        admins: Number(userStats?.admins ?? 0),
        free: Number(userStats?.freeUsers ?? 0),
        paid: Number(userStats?.paidUsers ?? 0),
      },
      workspaces: {
        total: Number(workspaceStats?.total ?? 0),
        running: Number(workspaceStats?.running ?? 0),
        stopped: Number(workspaceStats?.stopped ?? 0),
      },
    };
  }),
});

import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

export const workspaceAccessRole = pgEnum("workspace_access_role", [
  "viewer",
  "editor",
  "admin",
] as const);

export const workspaceShareInviteStatus = pgEnum(
  "workspace_share_invite_status",
  ["pending", "accepted", "declined", "cancelled"] as const,
);

export const workspaceShareTeamMemberRole = pgEnum(
  "workspace_share_team_member_role",
  ["member", "manager"] as const,
);

export const workspaceShareTeam = pgTable(
  "workspace_share_team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_share_team_creator_name_unique").on(
      table.creatorId,
      table.name,
    ),
  ],
);

export const workspaceShareTeamMember = pgTable(
  "workspace_share_team_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workspaceShareTeam.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceShareTeamMemberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("workspace_share_team_member_user_idx").on(table.userId),
    uniqueIndex("workspace_share_team_member_team_user_unique").on(
      table.teamId,
      table.userId,
    ),
  ],
);

export const workspaceShareTeamInvite = pgTable(
  "workspace_share_team_invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workspaceShareTeam.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    invitedUserId: text("invited_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: workspaceShareInviteStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    declinedAt: timestamp("declined_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_share_team_invite_team_email_unique").on(
      table.teamId,
      table.email,
    ),
  ],
);

export const workspaceUserAccess = pgTable(
  "workspace_user_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceAccessRole("role").notNull().default("viewer"),
    grantedByUserId: text("granted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("workspace_user_access_user_idx").on(table.userId),
    uniqueIndex("workspace_user_access_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
  ],
);

export const workspaceTeamAccess = pgTable(
  "workspace_team_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workspaceShareTeam.id, { onDelete: "cascade" }),
    role: workspaceAccessRole("role").notNull().default("viewer"),
    grantedByUserId: text("granted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("workspace_team_access_team_idx").on(table.teamId),
    uniqueIndex("workspace_team_access_workspace_team_unique").on(
      table.workspaceId,
      table.teamId,
    ),
  ],
);

export const workspaceShareInvite = pgTable(
  "workspace_share_invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    invitedUserId: text("invited_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    role: workspaceAccessRole("role").notNull().default("viewer"),
    tokenHash: text("token_hash").notNull().unique(),
    status: workspaceShareInviteStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    declinedAt: timestamp("declined_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_share_invite_workspace_email_unique").on(
      table.workspaceId,
      table.email,
    ),
  ],
);

export const workspaceShareTeamRelations = relations(
  workspaceShareTeam,
  ({ one, many }) => ({
    creator: one(user, {
      fields: [workspaceShareTeam.creatorId],
      references: [user.id],
    }),
    members: many(workspaceShareTeamMember),
    invites: many(workspaceShareTeamInvite),
    workspaceAccess: many(workspaceTeamAccess),
  }),
);

export type WorkspaceAccessRole = typeof workspaceAccessRole.enumValues[number];
export type WorkspaceShareInviteStatus = typeof workspaceShareInviteStatus.enumValues[number];
export type WorkspaceShareTeam = typeof workspaceShareTeam.$inferSelect;
export type NewWorkspaceShareTeam = typeof workspaceShareTeam.$inferInsert;
export type WorkspaceShareTeamMember = typeof workspaceShareTeamMember.$inferSelect;
export type WorkspaceShareTeamInvite = typeof workspaceShareTeamInvite.$inferSelect;
export type WorkspaceUserAccess = typeof workspaceUserAccess.$inferSelect;
export type WorkspaceTeamAccess = typeof workspaceTeamAccess.$inferSelect;
export type WorkspaceShareInvite = typeof workspaceShareInvite.$inferSelect;

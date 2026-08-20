import { relations, sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agentType, cloudProvider } from "./cloud";
import { workspace } from "./workspace";

export const workspaceSetupStatusEnum = pgEnum("workspace_setup_status", [
  "waiting",
  "running",
  "succeeded",
  "failed",
]);

export const workspaceSetup = pgTable("workspace_setup", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").notNull().unique(),
  status: workspaceSetupStatusEnum("status").notNull().default("waiting"),
  command: text("command").notNull(),
  exitCode: integer("exit_code"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  log: text("log"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceSetupCommandDefault = pgTable(
  "workspace_setup_command_default",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cloudProviderId: uuid("cloud_provider_id")
      .notNull()
      .references(() => cloudProvider.id, { onDelete: "cascade" }),
    agentTypeId: uuid("agent_type_id").references(() => agentType.id, {
      onDelete: "cascade",
    }),
    commands: jsonb("commands").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_setup_default_provider_unique")
      .on(table.cloudProviderId)
      .where(sql`${table.agentTypeId} is null`),
    uniqueIndex("workspace_setup_default_provider_agent_unique")
      .on(table.cloudProviderId, table.agentTypeId)
      .where(sql`${table.agentTypeId} is not null`),
  ],
);

export const workspaceSetupCommandDefaultRelations = relations(
  workspaceSetupCommandDefault,
  ({ one }) => ({
    cloudProvider: one(cloudProvider, {
      fields: [workspaceSetupCommandDefault.cloudProviderId],
      references: [cloudProvider.id],
    }),
    agentType: one(agentType, {
      fields: [workspaceSetupCommandDefault.agentTypeId],
      references: [agentType.id],
    }),
  }),
);

export type WorkspaceSetupCommandDefault = typeof workspaceSetupCommandDefault.$inferSelect;
export type WorkspaceSetup = typeof workspaceSetup.$inferSelect;

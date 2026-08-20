import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "pending",
  "running",
  "retrying",
  "completed",
  "failed",
  "cancelled",
]);

export type AgentRunMessageSnapshot = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  completedAt: string | null;
  text: string;
  error: string | null;
};

export const agentRun = pgTable(
  "agent_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    nativeSessionId: text("native_session_id"),
    status: agentRunStatusEnum("status").notNull().default("pending"),
    title: text("title").notNull(),
    errorMessage: text("error_message"),
    finalText: text("final_text"),
    messages: jsonb("messages").$type<AgentRunMessageSnapshot[]>().notNull().default([]),
    submittedAt: timestamp("submitted_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_run_workspace_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("agent_run_workspace_native_session_unique").on(
      table.workspaceId,
      table.nativeSessionId,
    ),
    index("agent_run_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const agentRunRelations = relations(agentRun, ({ one }) => ({
  workspace: one(workspace, {
    fields: [agentRun.workspaceId],
    references: [workspace.id],
  }),
}));

export type AgentRun = typeof agentRun.$inferSelect;
export type NewAgentRun = typeof agentRun.$inferInsert;

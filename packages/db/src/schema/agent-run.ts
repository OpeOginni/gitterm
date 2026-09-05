import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
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
  "awaiting_input",
  "completed",
  "failed",
  "cancelled",
]);

export type AgentRunMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      callId: string;
      tool: string;
      status: "pending" | "running" | "completed" | "error";
      title: string | null;
      input: Record<string, unknown>;
      /** Truncated tool output when completed. */
      output: string | null;
      error: string | null;
      startedAt: string | null;
      completedAt: string | null;
    };

/**
 * A prompt the agent is blocked on: an OpenCode permission request or a
 * `question` tool call. Answered through `run.respond`.
 */
export type AgentRunInputRequest =
  | {
      id: string;
      kind: "permission";
      createdAt: string | null;
      /** OpenCode tool call that raised the request, when known. */
      toolCallId: string | null;
      /** Permission action, e.g. "bash" or "edit". */
      permission: string;
      /** Resources the action applies to, e.g. shell commands or file paths. */
      patterns: string[];
      /** Patterns OpenCode would remember when replied with "always". */
      always: string[];
      title: string;
    }
  | {
      id: string;
      kind: "question";
      createdAt: string | null;
      toolCallId: string | null;
      questions: Array<{
        /** Runtime field key the answer is submitted under. */
        key: string;
        header: string;
        question: string;
        options: Array<{
          label: string;
          description: string;
          /** Runtime value submitted for this option when it differs from the label. */
          value?: string;
        }>;
        multiple: boolean;
        /** Whether a free-text answer outside `options` is accepted. */
        custom: boolean;
      }>;
    };

export type AgentRunMessageSnapshot = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  completedAt: string | null;
  text: string;
  error: string | null;
  /** Ordered text and tool-call parts; absent on rows captured before parts were recorded. */
  parts?: AgentRunMessagePart[];
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
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => agentRun.id, {
      onDelete: "set null",
    }),
    nativeSessionId: text("native_session_id"),
    nativeMessageId: text("native_message_id").notNull(),
    status: agentRunStatusEnum("status").notNull().default("pending"),
    title: text("title").notNull(),
    errorMessage: text("error_message"),
    finalText: text("final_text"),
    messages: jsonb("messages").$type<AgentRunMessageSnapshot[]>().notNull().default([]),
    /** Prompts the agent is blocked on; non-empty exactly while `awaiting_input`. */
    pendingInputs: jsonb("pending_inputs").$type<AgentRunInputRequest[]>().notNull().default([]),
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
    uniqueIndex("agent_run_parent_run_unique").on(table.parentRunId),
    index("agent_run_workspace_native_session_idx").on(table.workspaceId, table.nativeSessionId),
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

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { LocalProjectTable } from "./project"

import type { FileDiff, Todo, Message, Part } from "@opencode-ai/sdk"

type Ruleset = {
        permission: string;
        pattern: string;
        action: "allow" | "deny" | "ask";
    }[]

export const LocalSessionTable = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    projectID: text("project_id")
      .notNull()
      .references(() => LocalProjectTable.id, { onDelete: "cascade" }),
    parentID: text("parent_id"),
    slug: text("slug").notNull(),
    directory: text("directory").notNull(),
    title: text("title").notNull(),
    version: text("version").notNull(),
    share_url: text("share_url"),
    summary_additions: integer("summary_additions"),
    summary_deletions: integer("summary_deletions"),
    summary_files: integer("summary_files"),
    summary_diffs: text("summary_diffs", { mode: "json" }).$type<FileDiff[]>(),
    revert_messageID: text("revert_message_id"),
    revert_partID: text("revert_part_id"),
    revert_snapshot: text("revert_snapshot"),
    revert_diff: text("revert_diff"),
    permission: text("permission", { mode: "json" }).$type<Ruleset>(),
    time_created: integer("time_created").notNull(),
    time_updated: integer("time_updated").notNull(),
    time_compacting: integer("time_compacting"),
    time_archived: integer("time_archived"),
  },
  (table) => [index("session_project_idx").on(table.projectID), index("session_parent_idx").on(table.parentID)],
)

export const LocalMessageTable = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    sessionID: text("session_id")
      .notNull()
      .references(() => LocalSessionTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    data: text("data", { mode: "json" }).notNull().$type<Message>(),
  },
  (table) => [index("message_session_idx").on(table.sessionID)],
)

export const LocalPartTable = sqliteTable(
  "part",
  {
    id: text("id").primaryKey(),
    messageID: text("message_id")
      .notNull()
      .references(() => LocalMessageTable.id, { onDelete: "cascade" }),
    sessionID: text("session_id").notNull(),
    data: text("data", { mode: "json" }).notNull().$type<Part>(),
  },
  (table) => [index("part_message_idx").on(table.messageID), index("part_session_idx").on(table.sessionID)],
)

export const LocalSessionDiffTable = sqliteTable("session_diff", {
  sessionID: text("session_id")
    .primaryKey()
    .references(() => LocalSessionTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<FileDiff[]>(),
})

export const LocalTodoTable = sqliteTable("todo", {
  sessionID: text("session_id")
    .primaryKey()
    .references(() => LocalSessionTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<Todo>(),
})

export const LocalPermissionTable = sqliteTable("permission", {
  projectID: text("project_id")
    .primaryKey()
    .references(() => LocalProjectTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<Ruleset>(),
})

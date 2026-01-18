import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const syncProject = pgTable("sync_project", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").references(() => user.id).notNull(),
    blobSessionsDir: text("blob_sessions_dir").notNull(),
    blobChunksDir: text("blob_chunks_dir").notNull(),
    currentSnapshot: text("current_snapshot").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
    uniqueIndex("sync_project_user_id_project_id_unique").on(table.userId, table.projectId),
])

export const syncManifest = pgTable("sync_manifest", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id).notNull(),
    syncProjectId: uuid("sync_project_id").references(() => syncProject.id).notNull(),
    snapshot: text("snapshot").notNull(),
    createdAt: timestamp("created_at").notNull(),
    parentSnapshot: text("parent_snapshot"),
    files: jsonb("files").notNull().$type<Record<string, { size: number; chunks: string[]; mode?: number }>>(),
}, (table) => [
    uniqueIndex("sync_manifest_user_id_sync_project_id_unique").on(table.userId, table.syncProjectId),
])
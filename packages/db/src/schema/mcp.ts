import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

/** Credentials are encrypted at rest and delivered only to explicitly selected workspaces. */
export const mcpConnection = pgTable(
  "mcp_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    integration: text("integration").$type<"mcp" | "executor">().notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    authType: text("auth_type").$type<"none" | "headers">().notNull(),
    encryptedAuth: text("encrypted_auth").notNull(),
    status: text("status")
      .$type<"untested" | "connected" | "needs_auth" | "error">()
      .notNull()
      .default("untested"),
    codemode: boolean("codemode").notNull().default(true),
    revision: integer("revision").notNull().default(1),
    toolCount: integer("tool_count"),
    serverInfo: jsonb("server_info").$type<{ name: string; version: string } | null>(),
    lastCheckedAt: timestamp("last_checked_at"),
    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("mcp_connection_user_idx").on(table.userId)],
);

export const workspaceMcpConnection = pgTable(
  "workspace_mcp_connection",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mcpConnection.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.connectionId] })],
);

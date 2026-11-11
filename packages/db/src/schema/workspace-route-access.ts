import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

export const workspaceRouteAccess = pgTable(
  "workspace_route_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    port: integer("port"),
    encryptedHeaders: text("encrypted_headers").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("workspace_route_access_workspace_port_idx").on(table.workspaceId, table.port)],
);

export const workspaceRouteAccessRelations = relations(workspaceRouteAccess, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceRouteAccess.workspaceId],
    references: [workspace.id],
  }),
}));

export type NewWorkspaceRouteAccess = typeof workspaceRouteAccess.$inferInsert;
export type WorkspaceRouteAccess = typeof workspaceRouteAccess.$inferSelect;

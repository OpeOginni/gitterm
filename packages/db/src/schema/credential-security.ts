import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

/** Metadata-only credential audit. Never store tokens, payloads, or authorization headers here. */
export const workspaceCredentialAudit = pgTable(
  "workspace_credential_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialKind: text("credential_kind").notNull(),
    integrationId: uuid("integration_id"),
    action: text("action").notNull(),
    expiresAt: timestamp("expires_at"),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("workspace_credential_audit_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

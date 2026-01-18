import { pgTable, text, timestamp, uuid, boolean, jsonb, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth";

/**
 * Model Provider - List of supported LLM providers
 * Seeded data, not user-editable
 *
 * Examples: anthropic, openai, github-copilot
 */
export const modelProvider = pgTable("model_provider", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // "anthropic", "openai", "github-copilot"
  displayName: text("display_name").notNull(), // "Anthropic", "GitHub Copilot"
  authType: text("auth_type").notNull(), // "api_key" | "oauth"
  oauthConfig: jsonb("oauth_config"), // OAuth endpoints, client_id, scopes, etc.
  plugin: text("plugin"), // Optional: plugin name required (e.g., "copilot-auth")
  isEnabled: boolean("is_enabled").notNull().default(true),
  isRecommended: boolean("is_recommended").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Model - Models available for each provider
 * Seeded data, not user-editable
 *
 * Examples: claude-sonnet-4-20250514, gpt-4o
 */
export const model = pgTable(
  "model",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProvider.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "claude-sonnet-4-20250514"
    displayName: text("display_name").notNull(), // "Claude Sonnet 4"
    modelId: text("model_id").notNull(), // Full ID: "anthropic/claude-sonnet-4-20250514"
    isFree: boolean("is_free").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isRecommended: boolean("is_recommended").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique("model_provider_id_name").on(table.providerId, table.name)],
);

/**
 * User Model Credential - Encrypted credentials per user per provider
 *
 * Only persistent credentials are stored here.
 * Per-run (manual) credentials are never persisted.
 *
 * Encrypted credential format (AES-256-GCM, base64 encoded):
 * - API Key: { apiKey: "sk-..." }
 * - OAuth: { refresh: "gho_...", access: "...", expires: timestamp }
 */
export const userModelCredential = pgTable(
  "user_model_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProvider.id),

    // Encrypted credential (AES-256-GCM, base64 encoded)
    encryptedCredential: text("encrypted_credential").notNull(),

    // SHA-256 prefix for audit (first 16 chars)
    keyHash: text("key_hash").notNull(),

    // OAuth-specific: when access token expires (for auto-refresh)
    oauthExpiresAt: timestamp("oauth_expires_at"),

    // User-defined label (e.g., "Work account", "Personal")
    label: text("label"),

    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One credential per provider+label per user
    unique("user_model_credential_user_provider_label").on(
      table.userId,
      table.providerId,
      table.label,
    ),
  ],
);

/**
 * Model Credential Audit - Usage and lifecycle events
 *
 * Actions: "created", "used", "refreshed", "revoked"
 */
export const modelCredentialAudit = pgTable("model_credential_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id").references(() => userModelCredential.id, {
    onDelete: "set null",
  }),
  userId: text("user_id").notNull(),
  action: text("action").notNull(), // "created" | "used" | "refreshed" | "revoked"
  keyHash: text("key_hash"), // For identifying even after deletion
  context: jsonb("context"), // { loopId, runId, workspaceId }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const modelProviderRelations = relations(modelProvider, ({ many }) => ({
  models: many(model),
  credentials: many(userModelCredential),
}));

export const modelRelations = relations(model, ({ one }) => ({
  provider: one(modelProvider, {
    fields: [model.providerId],
    references: [modelProvider.id],
  }),
}));

export const userModelCredentialRelations = relations(userModelCredential, ({ one, many }) => ({
  user: one(user, {
    fields: [userModelCredential.userId],
    references: [user.id],
  }),
  provider: one(modelProvider, {
    fields: [userModelCredential.providerId],
    references: [modelProvider.id],
  }),
  auditLogs: many(modelCredentialAudit),
}));

export const modelCredentialAuditRelations = relations(modelCredentialAudit, ({ one }) => ({
  credential: one(userModelCredential, {
    fields: [modelCredentialAudit.credentialId],
    references: [userModelCredential.id],
  }),
}));

// Type exports
export type ModelProvider = typeof modelProvider.$inferSelect;
export type NewModelProvider = typeof modelProvider.$inferInsert;
export type Model = typeof model.$inferSelect;
export type NewModel = typeof model.$inferInsert;
export type UserModelCredential = typeof userModelCredential.$inferSelect;
export type NewUserModelCredential = typeof userModelCredential.$inferInsert;
export type ModelCredentialAudit = typeof modelCredentialAudit.$inferSelect;
export type NewModelCredentialAudit = typeof modelCredentialAudit.$inferInsert;

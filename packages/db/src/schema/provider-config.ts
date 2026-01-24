import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const providerCategoryEnum = ["compute", "sandbox", "both"] as const;
export const fieldTypeEnum = ["text", "password", "number", "select", "url", "boolean"] as const;

export const providerType = pgTable("provider_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  category: text("category")
    .notNull()
    .$type<typeof providerCategoryEnum[number]>(),
  configSchema: jsonb("config_schema").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isBuiltIn: boolean("is_built_in").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const providerConfig = pgTable("provider_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerTypeId: uuid("provider_type_id")
    .notNull()
    .references(() => providerType.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  configMetadata: jsonb("config_metadata"),
  isDefault: boolean("is_default").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const providerConfigField = pgTable("provider_config_field", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerTypeId: uuid("provider_type_id")
    .notNull()
    .references(() => providerType.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  fieldLabel: text("field_label").notNull(),
  fieldType: text("field_type")
    .notNull()
    .$type<typeof fieldTypeEnum[number]>(),
  isRequired: boolean("is_required").notNull().default(true),
  isEncrypted: boolean("is_encrypted").notNull().default(false),
  defaultValue: text("default_value"),
  options: jsonb("options"),
  validationRules: jsonb("validation_rules"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const providerTypeRelations = relations(providerType, ({ many }) => ({
  providerConfigs: many(providerConfig),
  configFields: many(providerConfigField),
}));

export const providerConfigRelations = relations(providerConfig, ({ one }) => ({
  providerType: one(providerType, {
    fields: [providerConfig.providerTypeId],
    references: [providerType.id],
  }),
}));

export const providerConfigFieldRelations = relations(providerConfigField, ({ one }) => ({
  providerType: one(providerType, {
    fields: [providerConfigField.providerTypeId],
    references: [providerType.id],
  }),
}));

export type ProviderType = typeof providerType.$inferSelect;
export type NewProviderType = typeof providerType.$inferInsert;
export type ProviderConfig = typeof providerConfig.$inferSelect;
export type NewProviderConfig = typeof providerConfig.$inferInsert;
export type ProviderConfigField = typeof providerConfigField.$inferSelect;
export type NewProviderConfigField = typeof providerConfigField.$inferInsert;

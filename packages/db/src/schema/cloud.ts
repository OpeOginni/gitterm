import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { relations } from "drizzle-orm";
import { volume, workspace } from "./workspace";

export const cloudAccount = pgTable("cloud_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  roleArn: text("role_arn").notNull(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => cloudProvider.id, { onDelete: "cascade" }),
  region: text("region").notNull(),
  externalId: text("external_id").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const cloudProvider = pgTable("cloud_provider", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isSandbox: boolean("is_sandbox").notNull().default(false), // true for Cloudflare, false for AWS/Railway
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const region = pgTable("region", {
  id: uuid("id").primaryKey().defaultRandom(),
  cloudProviderId: uuid("cloud_provider_id")
    .notNull()
    .references(() => cloudProvider.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  location: text("location").notNull(),
  externalRegionIdentifier: text("external_region_identifier").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const image = pgTable("image", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  imageId: text("image_id").notNull(),
  agentTypeId: uuid("agent_type_id")
    .notNull()
    .references(() => agentType.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentType = pgTable("agent_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  serverOnly: boolean("server_only").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cloudAccountRelations = relations(cloudAccount, ({ one }) => ({
  user: one(user, {
    fields: [cloudAccount.userId],
    references: [user.id],
  }),
  cloudProvider: one(cloudProvider, {
    fields: [cloudAccount.providerId],
    references: [cloudProvider.id],
  }),
}));

export const cloudProviderRelations = relations(cloudProvider, ({ many }) => ({
  regions: many(region),
  cloudAccounts: many(cloudAccount),
  volumes: many(volume),
}));

export const regionRelations = relations(region, ({ one, many }) => ({
  cloudProvider: one(cloudProvider, {
    fields: [region.cloudProviderId],
    references: [cloudProvider.id],
  }),
  workspaces: many(workspace),
  volumes: many(volume),
}));

export const imageRelations = relations(image, ({ one }) => ({
  agentType: one(agentType, {
    fields: [image.agentTypeId],
    references: [agentType.id],
  }),
}));

export type NewCloudProvider = typeof cloudProvider.$inferInsert;
export type NewImage = typeof image.$inferInsert;
export type NewAgentType = typeof agentType.$inferInsert;
export type NewCloudAccount = typeof cloudAccount.$inferInsert;

export type CloudProviderType = typeof cloudProvider.$inferSelect;
export type ImageType = typeof image.$inferSelect;
export type AgentType = typeof agentType.$inferSelect;
export type CloudAccountType = typeof cloudAccount.$inferSelect;
export type RegionType = typeof region.$inferSelect;

import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { relations, sql } from "drizzle-orm";
import { volume, workspace } from "./workspace";
import { providerConfig } from "./provider-config";

export const settlementEnum = pgEnum("settlement_enum", ["immediate", "webhook", "poll"] as const);

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
  providerConfigId: uuid("provider_config_id").references(() => providerConfig.id, {
    onDelete: "set null",
  }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isSandbox: boolean("is_sandbox").notNull().default(false),
  supportsRegions: boolean("supports_regions").notNull().default(true),
  allowUserRegionSelection: boolean("allow_user_region_selection").notNull().default(true),
  supportServerOnly: boolean("support_server_only").notNull().default(false),
  editorAccessSupport: jsonb("editor_access_support")
    .$type<CloudProviderEditorAccessSupport>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  creationSettlement: settlementEnum("creation_settlement").default("webhook"),
  stopSettlement: settlementEnum("stop_settlement").default("webhook"),
  restartSettlement: settlementEnum("restart_settlement").default("webhook"),
  terminationSettlement: settlementEnum("termination_settlement").default("webhook"),
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
  providerMetadata: jsonb("provider_metadata")
    .$type<ImageProviderMetadata>()
    .notNull()
    .default(sql`'{}'::jsonb`),
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

export const cloudProviderRelations = relations(cloudProvider, ({ one, many }) => ({
  providerConfig: one(providerConfig, {
    fields: [cloudProvider.providerConfigId],
    references: [providerConfig.id],
  }),
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

export interface CloudProviderEditorAccessSupport {
  supported?: boolean;
  transportKind?: "direct-ssh" | "proxycommand-ssh" | "managed-ssh";
  label?: string;
  description?: string;
  requiresLocalBinaries?: string[];
}

export interface DaytonaImageProviderMetadata {
  snapshot?: string;
  snapshotsByRegion?: Record<string, string | undefined>;
}

export interface AwsImageProviderMetadata {
  cpu?: number;
  memory?: number;
  containerPort?: number;
  healthCheckPath?: string;
  ephemeralStorageGiB?: number;
  architecture?: "X86_64" | "ARM64";
}

export interface ImageProviderMetadata {
  isDefault?: boolean;
  e2b?: {
    templateId?: string;
    sshTemplateId?: string;
  };
  daytona?: DaytonaImageProviderMetadata;
  aws?: AwsImageProviderMetadata;
  [provider: string]: unknown;
}

export type NewCloudProvider = typeof cloudProvider.$inferInsert;
export type NewImage = typeof image.$inferInsert;
export type NewAgentType = typeof agentType.$inferInsert;
export type NewCloudAccount = typeof cloudAccount.$inferInsert;
export type ProviderSettlement = (typeof settlementEnum.enumValues)[number];
export type CloudProviderType = typeof cloudProvider.$inferSelect;
export type ImageType = typeof image.$inferSelect;
export type AgentType = typeof agentType.$inferSelect;
export type CloudAccountType = typeof cloudAccount.$inferSelect;
export type RegionType = typeof region.$inferSelect;

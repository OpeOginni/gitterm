import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { relations, sql } from "drizzle-orm";
import { volume, workspace } from "./workspace";
import { providerConfig } from "./provider-config";

export const settlementEnum = pgEnum("settlement_enum", ["immediate", "webhook", "poll"] as const);

export interface MachineSelectionPolicy {
  mode: "standard" | "profiles" | "flexible";
  minimum?: Record<string, unknown>;
  maximum?: Record<string, unknown>;
}

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
  providerKey: text("provider_key").notNull().default("local"),
  providerConfigId: uuid("provider_config_id").references(() => providerConfig.id, {
    onDelete: "set null",
  }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isSandbox: boolean("is_sandbox").notNull().default(false),
  preferredDefault: boolean("preferred_default").notNull().default(false),
  autoPersistent: boolean("auto_persistent").notNull().default(false),
  supportsPersistence: boolean("supports_persistence").notNull().default(true),
  supportsRegions: boolean("supports_regions").notNull().default(true),
  allowUserRegionSelection: boolean("allow_user_region_selection").notNull().default(true),
  supportServerOnly: boolean("support_server_only").notNull().default(false),
  machineSelectionPolicy: jsonb("machine_selection_policy")
    .$type<MachineSelectionPolicy>()
    .notNull()
    .default(sql`'{"mode":"standard"}'::jsonb`),
  sshAccessSupport: jsonb("editor_access_support")
    .$type<CloudProvidersshAccessSupport>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  creationSettlement: settlementEnum("creation_settlement").default("webhook"),
  stopSettlement: settlementEnum("stop_settlement").default("webhook"),
  restartSettlement: settlementEnum("restart_settlement").default("webhook"),
  terminationSettlement: settlementEnum("termination_settlement").default("webhook"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const region = pgTable(
  "region",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cloudProviderId: uuid("cloud_provider_id")
      .notNull()
      .references(() => cloudProvider.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    location: text("location").notNull(),
    externalRegionIdentifier: text("external_region_identifier").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("region_provider_external_identifier_unique").on(
      table.cloudProviderId,
      table.externalRegionIdentifier,
    ),
  ],
);

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

export const providerLaunchProfile = pgTable(
  "provider_agent_image",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cloudProviderId: uuid("cloud_provider_id")
      .notNull()
      .references(() => cloudProvider.id, { onDelete: "cascade" }),
    agentTypeId: uuid("agent_type_id")
      .notNull()
      .references(() => agentType.id, { onDelete: "cascade" }),
    imageId: uuid("image_id")
      .notNull()
      .references(() => image.id, { onDelete: "cascade" }),
    machineProfileId: uuid("machine_profile_id").references(() => machineProfile.id, {
      onDelete: "set null",
    }),
    workspaceProfile: text("workspace_profile").notNull().default("standard"),
    runtimeConfig: jsonb("runtime_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_agent_image_unique").on(
      table.cloudProviderId,
      table.agentTypeId,
      table.workspaceProfile,
    ),
  ],
);

export const machineProfile = pgTable(
  "machine_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cloudProviderId: uuid("cloud_provider_id")
      .notNull()
      .references(() => cloudProvider.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    providerOptions: jsonb("provider_options")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isDefault: boolean("is_default").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("machine_profile_provider_key_unique").on(table.cloudProviderId, table.key),
  ],
);

export const agentType = pgTable("agent_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull().unique(),
  description: text("description"),
  provisionerKey: text("provisioner_key").notNull().default("opencode"),
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
  machineProfiles: many(machineProfile),
  launchProfiles: many(providerLaunchProfile),
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

export const providerLaunchProfileRelations = relations(providerLaunchProfile, ({ one }) => ({
  cloudProvider: one(cloudProvider, {
    fields: [providerLaunchProfile.cloudProviderId],
    references: [cloudProvider.id],
  }),
  agentType: one(agentType, {
    fields: [providerLaunchProfile.agentTypeId],
    references: [agentType.id],
  }),
  image: one(image, {
    fields: [providerLaunchProfile.imageId],
    references: [image.id],
  }),
  machineProfile: one(machineProfile, {
    fields: [providerLaunchProfile.machineProfileId],
    references: [machineProfile.id],
  }),
}));

export const machineProfileRelations = relations(machineProfile, ({ one, many }) => ({
  cloudProvider: one(cloudProvider, {
    fields: [machineProfile.cloudProviderId],
    references: [cloudProvider.id],
  }),
  workspaces: many(workspace),
  launchProfiles: many(providerLaunchProfile),
}));

export interface CloudProvidersshAccessSupport {
  supported?: boolean;
  transportKind?: "direct-ssh" | "proxycommand-ssh" | "managed-ssh";
  label?: string;
  description?: string;
  requiresLocalBinaries?: string[];
}

export interface DaytonaImageProviderMetadata {
  image?: string;
  resources?: { cpu?: number; memory?: number; disk?: number };
  editorResources?: { cpu?: number; memory?: number; disk?: number };
}

export interface AwsImageProviderMetadata {
  cpu?: number;
  memory?: number;
  containerPort?: number;
  healthCheckPath?: string;
  ephemeralStorageGiB?: number;
  architecture?: "X86_64" | "ARM64";
}

/**
 * Cloudflare-specific run details for an agent image. The Cloudflare worker is
 * agent-agnostic: it runs whatever `startCommand` listens on `port`, after
 * optionally running `setupCommands` (e.g. installing the agent binary on boot
 * for agents not baked into the container image).
 */
export interface CloudflareImageProviderMetadata {
  /** Command that starts the agent server, e.g. "opencode serve --port 4096". */
  startCommand?: string;
  /** Port the agent server listens on (workspace traffic is proxied here). */
  port?: number;
  /** Commands to run before starting the server (e.g. install the agent). */
  setupCommands?: string[];
}

export interface VercelImageProviderMetadata {
  /** Vercel Container Registry image that includes the selected coding agent. */
  image?: string;
  /** Vercel runtime for images that install the agent during startup. */
  runtime?: "node26" | "node24" | "node22" | "python3.13";
  /** Commands to run before starting the agent on a managed runtime. */
  setupCommands?: string[];
  /** Vercel allocates 2 GiB of memory for every vCPU. */
  vcpus?: number;
}

export interface UpstashImageProviderMetadata {
  runtime?:
    | "node"
    | "node-alpine"
    | "python"
    | "python-alpine"
    | "golang"
    | "golang-alpine"
    | "ruby"
    | "ruby-alpine"
    | "rust"
    | "rust-alpine";
  size?: "small" | "medium" | "large";
}

export interface AsciiImageProviderMetadata {
  size?: "small" | "default" | "large";
  /** Commands to run before starting the agent in the Box. */
  setupCommands?: string[];
}

export interface ExeDevImageProviderMetadata {
  image?: string;
  cpu?: number;
  memory?: string;
  disk?: string;
}

export interface ImageProviderMetadata {
  isDefault?: boolean;
  e2b?: {
    templateId?: string;
    sshTemplateId?: string;
  };
  daytona?: DaytonaImageProviderMetadata;
  aws?: AwsImageProviderMetadata;
  cloudflare?: CloudflareImageProviderMetadata;
  vercel?: VercelImageProviderMetadata;
  upstash?: UpstashImageProviderMetadata;
  ascii?: AsciiImageProviderMetadata;
  exedev?: ExeDevImageProviderMetadata;
  [provider: string]: unknown;
}

export type NewCloudProvider = typeof cloudProvider.$inferInsert;
export type NewImage = typeof image.$inferInsert;
export type NewProviderLaunchProfile = typeof providerLaunchProfile.$inferInsert;
export type NewMachineProfile = typeof machineProfile.$inferInsert;
export type NewAgentType = typeof agentType.$inferInsert;
export type NewCloudAccount = typeof cloudAccount.$inferInsert;
export type ProviderSettlement = (typeof settlementEnum.enumValues)[number];
export type CloudProviderType = typeof cloudProvider.$inferSelect;
export type ImageType = typeof image.$inferSelect;
export type AgentType = typeof agentType.$inferSelect;
export type CloudAccountType = typeof cloudAccount.$inferSelect;
export type RegionType = typeof region.$inferSelect;
export type MachineProfileType = typeof machineProfile.$inferSelect;

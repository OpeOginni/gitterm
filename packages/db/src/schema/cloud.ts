import { boolean, PgColumn, pgTable, text, timestamp, uuid, type PgTableWithColumns } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { relations } from "drizzle-orm";
import { volume, workspace } from "./workspace";

export const cloudAccount = pgTable("cloud_account", {
	id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    roleArn: text("role_arn").notNull(),
    providerId: uuid("provider_id").notNull().references(() => cloudProvider.id, { onDelete: "cascade" }),
    region: text("region").notNull(),
    externalId: text("external_id").notNull(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const cloudProvider = pgTable("cloud_provider", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const region = pgTable("region", {
	id: uuid("id").primaryKey().defaultRandom(),
	cloudProviderId: uuid("cloud_provider_id").notNull().references(() => cloudProvider.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	location: text("location").notNull(),
	externalRegionIdentifier: text("external_region_identifier").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const image = pgTable("image", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	imageId: text("image_id").notNull(),
    agentTypeId: uuid("agent_type_id").notNull().references(() => agentType.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentType = pgTable("agent_type", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	serverOnly: boolean("server_only").notNull().default(false),
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


export const regionRelations = relations(region, ({ one, many}) => ({
	cloudProvider: one(cloudProvider, {
		fields: [region.cloudProviderId],
		references: [cloudProvider.id],
	}),
	workspaces: many(workspace),
	volumes: many(volume),
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

function many(workspace: PgTableWithColumns<{ name: "workspace"; schema: undefined; columns: { id: PgColumn<{ name: "id"; tableName: "workspace"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; externalInstanceId: PgColumn<{ name: "external_instance_id"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; externalRunningDeploymentId: PgColumn<{ name: "external_running_deployment_id"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; userId: PgColumn<{ name: "user_id"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; imageId: PgColumn<{ name: "image_id"; tableName: "workspace"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; cloudProviderId: PgColumn<{ name: "cloud_provider_id"; tableName: "workspace"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; regionId: PgColumn<{ name: "region_id"; tableName: "workspace"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; repositoryUrl: PgColumn<{ name: "repository_url"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; domain: PgColumn<{ name: "domain"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; subdomain: PgColumn<{ name: "subdomain"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; backendUrl: PgColumn<{ name: "backend_url"; tableName: "workspace"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; status: PgColumn<{ name: "status"; tableName: "workspace"; dataType: "string"; columnType: "PgEnumColumn"; data: "pending" | "running" | "stopped" | "terminated"; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: ["pending", "running", "stopped", "terminated"]; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; startedAt: PgColumn<{ name: "started_at"; tableName: "workspace"; dataType: "date"; columnType: "PgTimestamp"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; stoppedAt: PgColumn<{ name: "stopped_at"; tableName: "workspace"; dataType: "date"; columnType: "PgTimestamp"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; terminatedAt: PgColumn<{ name: "terminated_at"; tableName: "workspace"; dataType: "date"; columnType: "PgTimestamp"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; lastActiveAt: PgColumn<{ name: "last_active_at"; tableName: "workspace"; dataType: "date"; columnType: "PgTimestamp"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; updatedAt: PgColumn<{ name: "updated_at"; tableName: "workspace"; dataType: "date"; columnType: "PgTimestamp"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>; }; dialect: "pg"; }>, arg1: { fields: PgColumn<{ name: "id"; tableName: "cloud_account"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}, {}>[]; references: any[]; }): any {
	throw new Error("Function not implemented.");
}

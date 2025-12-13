import { jsonb, pgTable, text, timestamp, uuid, pgEnum, integer, date, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { agentType, cloudProvider, image, region } from "./cloud";
import { relations } from "drizzle-orm";
import { gitIntegration } from "./integrations";

export const instanceStatusEnum = pgEnum('instance_status', ['pending', 'running', 'stopped', 'terminated'] as const);
export const workspaceStatusEnum = pgEnum('workspace_status', ['pending', 'running', 'stopped', 'terminated'] as const);
export const sessionStopSourceEnum = pgEnum('session_stop_source', ['manual', 'idle', 'quota_exhausted', 'error'] as const);
export const workspaceTunnelTypeEnum = pgEnum('workspace_tunnel_type', ['cloud', 'local'] as const);

export const workspace = pgTable("workspace", {
	id: uuid("id").primaryKey().defaultRandom(),
	externalInstanceId: text("external_instance_id").notNull(),
	externalRunningDeploymentId: text("external_running_deployment_id"),
    gitIntegrationId: uuid("git_integration_id").references(() => gitIntegration.id, { onDelete: "set null" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	imageId: uuid("image_id").notNull().references(() => image.id, { onDelete: "cascade" }),
	cloudProviderId: uuid("cloud_provider_id").notNull().references(() => cloudProvider.id, { onDelete: "cascade" }),
	regionId: uuid("region_id").notNull().references(() => region.id, { onDelete: "cascade" }),
    repositoryUrl: text("repository_url"),
    domain: text("domain").notNull(), // Full domain: ws-123.gitterm.dev
    subdomain: text("subdomain").unique(), // ws-123
    backendUrl: text("backend_url"), // Internal URL
    status: workspaceStatusEnum("status").notNull(),
	persistent: boolean("persistent").notNull().default(false),
	serverOnly: boolean("server_only").notNull().default(false),

	// Local tunnel support
	tunnelType: workspaceTunnelTypeEnum("tunnel_type").notNull().default("cloud"),
	tunnelName: text("tunnel_name"),
	reservedSubdomain: text("reserved_subdomain"), // paid feature
	localPort: integer("local_port"), // primary local port for tunnelType=local
	exposedPorts: jsonb("exposed_ports").$type<Record<string, { port: number; description?: string }>>(),
	tunnelConnectedAt: timestamp("tunnel_connected_at"),
	tunnelLastPingAt: timestamp("tunnel_last_ping_at"),

	startedAt: timestamp("started_at").notNull(),
	stoppedAt: timestamp("stopped_at"),
	terminatedAt: timestamp("terminated_at"),
	lastActiveAt: timestamp("last_active_at"),
	updatedAt: timestamp("updated_at").notNull(),
});

export const volume = pgTable("volume", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	cloudProviderId: uuid("cloud_provider_id").notNull().references(() => cloudProvider.id, { onDelete: "cascade" }),
	regionId: uuid("region_id").notNull().references(() => region.id, { onDelete: "cascade" }),
	externalVolumeId: text("external_volume_id").notNull(),
	mountPath: text("mount_path").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// Tracks each usage session (start → stop) for billing
export const usageSession = pgTable("usage_session", {
	id: uuid("id").primaryKey().defaultRandom(),
	workspaceId: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	startedAt: timestamp("started_at").notNull(),
	stoppedAt: timestamp("stopped_at"),
	durationMinutes: integer("duration_minutes"),
	stopSource: sessionStopSourceEnum("stop_source"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Tracks daily usage per user for free-tier enforcement
export const dailyUsage = pgTable("daily_usage", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	date: date("date").notNull(),
	minutesUsed: integer("minutes_used").notNull().default(0),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentWorkspaceConfig = pgTable("workspace_config", {
	id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	agentTypeId: uuid("agent_type_id").notNull().references(() => agentType.id, { onDelete: "cascade" }),
    config: jsonb("config").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceEnvironmentVariables = pgTable("workspace_environment_variables", {
	id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    agentTypeId: uuid("agent_type_id").notNull().references(() => agentType.id, { onDelete: "cascade" }),
	environmentVariables: jsonb("environment_variables").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
	region: one(region, {
		fields: [workspace.regionId],
		references: [region.id],
	}),
	volume: one(volume, {
		fields: [workspace.id],
		references: [volume.workspaceId],
	}),
	usageSessions: many(usageSession),
	gitIntegration: one(gitIntegration, {
		fields: [workspace.gitIntegrationId],
		references: [gitIntegration.id],
	}),
	image: one(image, {
		fields: [workspace.imageId],
		references: [image.id],
	}),
}));

export const usageSessionRelations = relations(usageSession, ({ one }) => ({
	workspace: one(workspace, {
		fields: [usageSession.workspaceId],
		references: [workspace.id],
	}),
}));

export const volumeRelations = relations(volume, ({ one }) => ({
	workspace: one(workspace, {
		fields: [volume.workspaceId],
		references: [workspace.id],
	}),
	cloudProvider: one(cloudProvider, {
		fields: [volume.cloudProviderId],
		references: [cloudProvider.id],
	}),
	region: one(region, {
		fields: [volume.regionId],
		references: [region.id],
	}),
}));

export type NewWorkspace = typeof workspace.$inferInsert;
export type Workspace = typeof workspace.$inferSelect;
export type NewAgentWorkspaceConfig = typeof agentWorkspaceConfig.$inferInsert;
export type NewWorkspaceEnvironmentVariables = typeof workspaceEnvironmentVariables.$inferInsert;
export type AgentWorkspaceConfig = typeof agentWorkspaceConfig.$inferSelect;
export type WorkspaceEnvironmentVariables = typeof workspaceEnvironmentVariables.$inferSelect;
export type NewUsageSession = typeof usageSession.$inferInsert;
export type UsageSession = typeof usageSession.$inferSelect;
export type NewDailyUsage = typeof dailyUsage.$inferInsert;
export type DailyUsage = typeof dailyUsage.$inferSelect;
export type SessionStopSource = typeof sessionStopSourceEnum.enumValues[number];
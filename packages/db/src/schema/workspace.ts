import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { agentType, image } from "./cloud";
import { cloudProvider, workspaceStatusEnum } from "./cloud";

export const workspace = pgTable("workspace", {
	id: uuid("id").primaryKey().defaultRandom(),
	externalInstanceId: text("external_instance_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	imageId: uuid("image_id").notNull().references(() => image.id, { onDelete: "cascade" }),
	cloudProviderId: uuid("cloud_provider_id").notNull().references(() => cloudProvider.id, { onDelete: "cascade" }),
	region: text("region").notNull(),
    repositoryUrl: text("repository_url"),
    domain: text("domain"), // Full domain: ws-123.gitterm.dev
    subdomain: text("subdomain").unique(), // ws-123
    backendUrl: text("backend_url"), // Internal URL
    status: workspaceStatusEnum("status").notNull(),
	startAt: timestamp("start_at").notNull(),
	endAt: timestamp("end_at"),
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

export type NewWorkspace = typeof workspace.$inferInsert;
export type Workspace = typeof workspace.$inferSelect;
export type NewAgentWorkspaceConfig = typeof agentWorkspaceConfig.$inferInsert;
export type NewWorkspaceEnvironmentVariables = typeof workspaceEnvironmentVariables.$inferInsert;
export type AgentWorkspaceConfig = typeof agentWorkspaceConfig.$inferSelect;
export type WorkspaceEnvironmentVariables = typeof workspaceEnvironmentVariables.$inferSelect;
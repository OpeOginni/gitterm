import {
  type AnyPgColumn,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ExposedPort } from "@gitterm/schema/workspace-ports";
import { user } from "./auth";
import {
  agentType,
  cloudProvider,
  image,
  machineProfile,
  providerLaunchProfile,
  region,
} from "./cloud";
import { relations, sql } from "drizzle-orm";
import { gitIntegration, googleCloudIntegration } from "./integrations";

/** Legacy marker; see `workspace.opencodeApi`. */
export const opencodeApiEnum = pgEnum("opencode_api", ["v1", "v2"] as const);
export type OpencodeApi = (typeof opencodeApiEnum.enumValues)[number];

export const instanceStatusEnum = pgEnum("instance_status", [
  "pending",
  "running",
  "paused",
  "terminated",
] as const);
export const workspaceStatusEnum = pgEnum("workspace_status", [
  "pending",
  "running",
  "paused",
  "terminated",
] as const);
export const sessionStopSourceEnum = pgEnum("session_stop_source", [
  "manual",
  "idle",
  "quota_exhausted",
  "provider_auto",
  "error",
] as const);
export const workspaceHostingTypeEnum = pgEnum("workspace_hosting_type", [
  "cloud",
  "local",
] as const);
export const workspaceProfileEnum = pgEnum("workspace_profile", [
  "standard",
  "ssh-enabled",
] as const);

export const WORKSPACE_EDITOR_TARGETS = ["vscode", "neovim"] as const;
export type WorkspaceEditorTarget = (typeof WORKSPACE_EDITOR_TARGETS)[number];
export const workspaceEditorTargetEnum = pgEnum(
  "workspace_editor_target",
  WORKSPACE_EDITOR_TARGETS,
);
export interface WorkspaceSSHConnection {
  transportKind: "direct-ssh" | "proxycommand-ssh" | "managed-ssh";
  host: string;
  port: number;
  externalConnectionId?: string;
  /** Encrypted provider token used only to revoke editor access. */
  revocationToken?: string;
  expiresAt?: string;
}

export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Server-assigned identity, not caller-editable metadata. */
    botId: uuid("bot_id"),
    externalInstanceId: text("external_instance_id").notNull(),
    externalRunningDeploymentId: text("external_running_deployment_id"),
    gitIntegrationId: uuid("git_integration_id").references(() => gitIntegration.id, {
      onDelete: "set null",
    }),
    /**
     * Admin-provided (shared) git connection explicitly attached at creation, e.g. `github:shared`
     * for the deployment PAT. Never applied to workspaces created without consent.
     */
    sharedGitConnectionId: text("shared_git_connection_id"),
    googleCloudIntegrationId: uuid("google_cloud_integration_id").references(
      () => googleCloudIntegration.id,
      { onDelete: "set null" },
    ),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    imageId: uuid("image_id")
      .notNull()
      .references(() => image.id, { onDelete: "cascade" }),
    cloudProviderId: uuid("cloud_provider_id")
      .notNull()
      .references(() => cloudProvider.id, { onDelete: "cascade" }),
    regionId: uuid("region_id").references(() => region.id, {
      onDelete: "cascade",
    }),
    machineProfileId: uuid("machine_profile_id").references(() => machineProfile.id, {
      onDelete: "set null",
    }),
    launchProfileId: uuid("launch_profile_id").references(() => providerLaunchProfile.id, {
      onDelete: "set null",
    }),
    repositoryUrl: text("repository_url"),
    repositoryBranch: text("repository_branch"),
    /** Exact git commit the workspace was created from (full SHA when available). */
    repositoryBaseCommit: text("repository_base_commit"),
    /** Optional provider checkout ref (branch/tag) when distinct from display branch. */
    repositoryCheckoutRef: text("repository_checkout_ref"),
    domain: text("domain").notNull(), // Full domain: {uuid}.gitterm.dev or just {uuid} in path mode
    subdomain: text("subdomain"), // The workspace URL identifier (UUID format)
    upstreamUrl: text("upstream_url"), // URL to proxy requests to (cloud container or tunnel endpoint)
    status: workspaceStatusEnum("status").notNull(),
    /** Increment to revoke every workspace-issued bearer token immediately. */
    authVersion: integer("auth_version").notNull().default(1),
    persistent: boolean("persistent").notNull().default(false),
    serverOnly: boolean("server_only").notNull().default(false),
    workspaceProfile: workspaceProfileEnum("workspace_profile").notNull().default("standard"),
    editorAccessEnabled: boolean("editor_access_enabled").notNull().default(false),
    editorTarget: workspaceEditorTargetEnum("editor_target"),
    sshConnection: jsonb("editor_connection").$type<WorkspaceSSHConnection | null>(),
    modelCredentialIds: jsonb("model_credential_ids").$type<string[]>().notNull().default([]),
    inlineModelProviders: jsonb("inline_model_providers").$type<string[]>().notNull().default([]),
    setupRequired: boolean("setup_required").notNull().default(false),
    /**
     * Every workspace speaks the OpenCode 2 `/api/*` API. The column and its `v1`
     * enum value remain only so older rows and a rollback stay schema-compatible.
     */
    opencodeApi: opencodeApiEnum("opencode_api").notNull().default("v2"),

    // Workspace hosting configuration
    hostingType: workspaceHostingTypeEnum("hosting_type").notNull().default("cloud"),
    /** Never paused for inactivity; spending limits still apply. */
    alwaysOn: boolean("always_on").notNull().default(false),
    name: text("name"), // Display name for the workspace
    idempotencyKey: text("idempotency_key"),
    /** Caller-owned key/value tags (e.g. tenant or channel ids), filterable in list. */
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    /** When set, the reaper terminates the workspace at this time regardless of activity. */
    autoTerminateAt: timestamp("auto_terminate_at"),
    /** The snapshot an agent sandbox started from; cleared when the snapshot is deleted. */
    snapshotId: uuid("snapshot_id").references((): AnyPgColumn => sandboxSnapshot.id, {
      onDelete: "set null",
    }),
    /**
     * Held by the create or restart working on a `pending` workspace, renewed while it runs.
     * Reconciling with the provider leaves the workspace to it until this passes.
     */
    operationLeaseUntil: timestamp("operation_lease_until"),
    /** Caller-supplied public image (registry reference or E2B template) used instead of the catalog image. */
    customImage: text("custom_image"),
    reservedSubdomain: text("reserved_subdomain"), // paid feature for custom subdomains
    exposedPorts: jsonb("exposed_ports").$type<Record<string, ExposedPort>>(),
    serverPassword: text("server_password"),
    startedAt: timestamp("started_at").notNull(),
    pausedAt: timestamp("paused_at"),
    terminatedAt: timestamp("terminated_at"),
    lastActiveAt: timestamp("last_active_at"),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_user_idempotency_key_unique").on(table.userId, table.idempotencyKey),
    // The proxy resolves every uncached request by subdomain; creates check it for uniqueness.
    index("workspace_subdomain_idx").on(table.subdomain),
    // Provider webhooks and compute job events find the workspace by its provider id.
    index("workspace_external_instance_idx").on(table.externalInstanceId),
    // Reaper passes read by status. Terminated rows are most of the table, so leave them out.
    index("workspace_live_status_idx")
      .on(table.status)
      .where(sql`${table.status} <> 'terminated'`),
  ],
);

export const volume = pgTable("volume", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  cloudProviderId: uuid("cloud_provider_id")
    .notNull()
    .references(() => cloudProvider.id, { onDelete: "cascade" }),
  regionId: uuid("region_id").references(() => region.id, {
    onDelete: "cascade",
  }),
  externalVolumeId: text("external_volume_id").notNull(),
  mountPath: text("mount_path").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * A machine snapshot saved in the deployment's provider account. Counted against the
 * owner's plan limit. A row without `externalSnapshotId` is being saved. Rows outlive a
 * deleted user (`userId` null) so the provider snapshot can still be found and removed.
 *
 * There are two kinds. A sandbox snapshot (`repositoryUrl` null) is one a managed sandbox
 * saved; new sandboxes start from it. A project snapshot (`repositoryUrl` set) is a cloud
 * agent workspace kept when the user was done with it; their next workspace for that
 * repository on that provider starts from it. A user has at most one per repository and
 * provider: saving another replaces it.
 */
export const sandboxSnapshot = pgTable(
  "sandbox_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    cloudProviderId: uuid("cloud_provider_id")
      .notNull()
      .references(() => cloudProvider.id, { onDelete: "cascade" }),
    /** The size it was saved at; sandboxes started from it are billed at this size. */
    machineProfileId: uuid("machine_profile_id").references(() => machineProfile.id, {
      onDelete: "set null",
    }),
    externalSnapshotId: text("external_snapshot_id"),
    label: text("label").notNull(),
    /** Set on a project snapshot: the repository whose workspaces start from it. */
    repositoryUrl: text("repository_url"),
    /**
     * Set on a project snapshot: the image the workspace ran. A workspace only starts from
     * a snapshot of the image it would otherwise use, so an image update retires old ones.
     */
    imageId: uuid("image_id").references(() => image.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("sandbox_snapshot_user_idx").on(table.userId),
    index("sandbox_snapshot_project_idx").on(table.userId, table.repositoryUrl),
  ],
);

/** Durable teardown intent. Kept until provider and local cleanup both succeed. */
export const workspaceTermination = pgTable("workspace_termination", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  generation: uuid("generation").notNull().defaultRandom(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  leaseUntil: timestamp("lease_until"),
});

// Tracks each usage session (start → stop) for billing
export const usageSession = pgTable(
  "usage_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at").notNull(),
    stoppedAt: timestamp("stopped_at"),
    durationMinutes: integer("duration_minutes"),
    stopSource: sessionStopSourceEnum("stop_source"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Closing a workspace's open session runs on every pause, terminate and webhook.
    index("usage_session_workspace_idx").on(table.workspaceId),
    // Usage and allowance checks read one user's sessions.
    index("usage_session_user_stopped_idx").on(table.userId, table.stoppedAt),
  ],
);

export const agentConfigKindEnum = pgEnum("agent_config_kind", [
  "opencode",
  "claude-code",
  "codex",
] as const);

export const agentWorkspaceConfig = pgTable("workspace_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  kind: agentConfigKindEnum("kind").notNull().default("opencode"),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceEnvironmentVariables = pgTable("workspace_environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  agentTypeId: uuid("agent_type_id")
    .notNull()
    .references(() => agentType.id, { onDelete: "cascade" }),
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
  cloudProvider: one(cloudProvider, {
    fields: [workspace.cloudProviderId],
    references: [cloudProvider.id],
  }),
  machineProfile: one(machineProfile, {
    fields: [workspace.machineProfileId],
    references: [machineProfile.id],
  }),
  launchProfile: one(providerLaunchProfile, {
    fields: [workspace.launchProfileId],
    references: [providerLaunchProfile.id],
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
export type SessionStopSource = (typeof sessionStopSourceEnum.enumValues)[number];

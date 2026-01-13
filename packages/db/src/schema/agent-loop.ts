import { pgTable, text, timestamp, uuid, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { gitIntegration } from "./integrations";
import { cloudProvider } from "./cloud";
import { modelProvider, model, userModelCredential } from "./model-credentials";
import { relations } from "drizzle-orm";

// Agent loop status enum
export const agentLoopStatusEnum = pgEnum("agent_loop_status", [
  "active",
  "paused",
  "completed",
  "archived",
]);

// Agent loop run status enum
export const agentLoopRunStatusEnum = pgEnum("agent_loop_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "halted", // The loop run was halted automatically due to quota exhaustion
]);

// Agent loop run trigger type enum
export const agentLoopRunTriggerTypeEnum = pgEnum("agent_loop_run_trigger_type", [
  "manual",
  "automated",
]);

/**
 * Agent Loop - The central loop / series
 *
 * A loop represents an ongoing autonomous coding task that can have multiple runs.
 * Each run spins up a Cloudflare sandbox, reads the plan, makes changes, and commits.
 */
export const agentLoop = pgTable("agent_loop", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  gitIntegrationId: uuid("git_integration_id").references(() => gitIntegration.id, {
    onDelete: "set null",
  }),
  sandboxProviderId: uuid("sandbox_provider_id")
    .notNull()
    .references(() => cloudProvider.id, { onDelete: "cascade" }),

  // Repository info
  repositoryOwner: text("repository_owner").notNull(),
  repositoryName: text("repository_name").notNull(),
  branch: text("branch").notNull(),

  // Plan and progress file paths (relative to repo root)
  planFilePath: text("plan_file_path").notNull(), // e.g., ".ralph/plan.md"
  progressFilePath: text("progress_file_path"), // e.g., ".ralph/progress.md", nullable

  prompt: text("prompt"),

  // AI configuration (stored on loop for automated runs)
  modelProviderId: uuid("model_provider_id")
    .notNull()
    .references(() => modelProvider.id),
  modelId: uuid("model_id")
    .notNull()
    .references(() => model.id),
  // User's model credential for automated runs
  credentialId: uuid("credential_id").references(() => userModelCredential.id, {
    onDelete: "set null",
  }),

  // Automation settings
  automationEnabled: boolean("automation_enabled").notNull().default(false),

  // Loop status
  status: agentLoopStatusEnum("status").notNull().default("active"),

  // Run counters
  totalRuns: integer("total_runs").notNull().default(0),
  successfulRuns: integer("successful_runs").notNull().default(0),
  failedRuns: integer("failed_runs").notNull().default(0),
  maxRuns: integer("max_runs").notNull().default(20), // Limit of 20 iterations

  // Last run reference
  lastRunId: uuid("last_run_id"), // Will be updated after each run (no FK to avoid circular dep)
  lastRunAt: timestamp("last_run_at"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Agent Loop Run - Individual run within a loop
 *
 * Each run represents a single execution of the loop:
 * - Spins up Cloudflare sandbox
 * - Reads plan file
 * - Makes changes
 * - Updates progress file
 * - Creates one commit
 * - Dies
 */
export const agentLoopRun = pgTable("agent_loop_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  loopId: uuid("loop_id")
    .notNull()
    .references(() => agentLoop.id, { onDelete: "cascade" }),

  // Run sequence number within the loop
  runNumber: integer("run_number").notNull(),

  // Run status and trigger
  status: agentLoopRunStatusEnum("status").notNull().default("pending"),
  triggerType: agentLoopRunTriggerTypeEnum("trigger_type").notNull(),

  // AI configuration used for this run
  modelProviderId: uuid("model_provider_id")
    .notNull()
    .references(() => modelProvider.id),
  modelId: uuid("model_id")
    .notNull()
    .references(() => model.id),

  // Cloudflare sandbox identifier
  sandboxId: text("sandbox_id"),

  // Timing
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  durationSeconds: integer("duration_seconds"),

  // Commit info (the output of the run)
  commitSha: text("commit_sha"),
  commitMessage: text("commit_message"),

  // Error info (if failed)
  errorMessage: text("error_message"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userLoopRunQuota = pgTable("user_loop_run_quota", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull().unique()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  monthlyRuns: integer("monthly_runs").notNull().default(0),
  extraRuns: integer("extra_runs").notNull().default(0),
  nextMonthlyResetAt: timestamp("next_monthly_reset_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

export const userLoopRunEvent = pgTable("user_loop_run_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  runsUsed: integer("runs_used").notNull().default(0),
  runsAdded: integer("runs_added").notNull().default(0),
  loopId: uuid("loop_id").references(() => agentLoop.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => agentLoopRun.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const agentLoopRelations = relations(agentLoop, ({ one, many }) => ({
  user: one(user, {
    fields: [agentLoop.userId],
    references: [user.id],
  }),
  gitIntegration: one(gitIntegration, {
    fields: [agentLoop.gitIntegrationId],
    references: [gitIntegration.id],
  }),
  sandboxProvider: one(cloudProvider, {
    fields: [agentLoop.sandboxProviderId],
    references: [cloudProvider.id],
  }),
  modelProvider: one(modelProvider, {
    fields: [agentLoop.modelProviderId],
    references: [modelProvider.id],
  }),
  model: one(model, {
    fields: [agentLoop.modelId],
    references: [model.id],
  }),
  credential: one(userModelCredential, {
    fields: [agentLoop.credentialId],
    references: [userModelCredential.id],
  }),
  runs: many(agentLoopRun),
}));

export const agentLoopRunRelations = relations(agentLoopRun, ({ one }) => ({
  loop: one(agentLoop, {
    fields: [agentLoopRun.loopId],
    references: [agentLoop.id],
  }),
  modelProvider: one(modelProvider, {
    fields: [agentLoopRun.modelProviderId],
    references: [modelProvider.id],
  }),
  model: one(model, {
    fields: [agentLoopRun.modelId],
    references: [model.id],
  }),
}));

// Type exports
export type AgentLoop = typeof agentLoop.$inferSelect;
export type NewAgentLoop = typeof agentLoop.$inferInsert;
export type AgentLoopRun = typeof agentLoopRun.$inferSelect;
export type NewAgentLoopRun = typeof agentLoopRun.$inferInsert;
export type AgentLoopStatus = (typeof agentLoopStatusEnum.enumValues)[number];
export type AgentLoopRunStatus = (typeof agentLoopRunStatusEnum.enumValues)[number];
export type AgentLoopRunTriggerType = (typeof agentLoopRunTriggerTypeEnum.enumValues)[number];

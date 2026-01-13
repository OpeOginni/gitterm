import { pgTable, text, timestamp, uuid, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { relations } from "drizzle-orm";

// Enum for git providers (extensible for GitLab, Bitbucket, etc.)
export const gitProviderEnum = pgEnum("git_provider", ["github", "gitlab", "bitbucket"] as const);

// GitHub App installations - tracks which users have installed the GitHub App
export const githubAppInstallation = pgTable("github_app_installation", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),

  // GitHub App installation data
  installationId: text("installation_id").notNull().unique(), // GitHub's installation ID
  accountId: text("account_id").notNull(), // GitHub user/org ID
  accountLogin: text("account_login").notNull(), // GitHub username/org name
  accountType: text("account_type").notNull(), // "User" or "Organization"

  // Permissions granted
  repositorySelection: text("repository_selection").notNull(), // "all" or "selected"

  // Status tracking
  suspended: boolean("suspended").notNull().default(false),
  suspendedAt: timestamp("suspended_at"),

  // Timestamps
  installedAt: timestamp("installed_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Generic Git integration table (for future providers like GitLab)
export const gitIntegration = pgTable("git_integration", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),

  provider: gitProviderEnum("provider").notNull(),

  // Provider-specific installation reference
  providerInstallationId: text("provider_installation_id").notNull(), // e.g., GitHub installation ID

  // User info from provider
  providerAccountId: text("provider_account_id").notNull(),
  providerAccountLogin: text("provider_account_login").notNull(),

  // Status
  active: boolean("active").notNull().default(true),

  // Timestamps
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Workspace Git configuration - links workspaces to git repos
export const workspaceGitConfig = pgTable("workspace_git_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().unique(), // One config per workspace
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),

  // Git provider info
  provider: gitProviderEnum("provider").notNull(),
  gitIntegrationId: uuid("git_integration_id").references(() => gitIntegration.id, {
    onDelete: "set null",
  }),

  // Repository info
  repositoryUrl: text("repository_url").notNull(),
  repositoryOwner: text("repository_owner").notNull(),
  repositoryName: text("repository_name").notNull(),

  // Fork tracking
  isFork: boolean("is_fork").notNull().default(false),
  originalOwner: text("original_owner"), // Original repo owner if this is a fork
  originalRepo: text("original_repo"), // Original repo name if this is a fork
  forkCreatedAt: timestamp("fork_created_at"),

  // Branch info
  defaultBranch: text("default_branch").notNull().default("main"),
  currentBranch: text("current_branch"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations
export const githubAppInstallationRelations = relations(githubAppInstallation, ({ one }) => ({
  user: one(user, {
    fields: [githubAppInstallation.userId],
    references: [user.id],
  }),
}));

export const gitIntegrationRelations = relations(gitIntegration, ({ one, many }) => ({
  user: one(user, {
    fields: [gitIntegration.userId],
    references: [user.id],
  }),
  workspaceGitConfigs: many(workspaceGitConfig),
}));

export const workspaceGitConfigRelations = relations(workspaceGitConfig, ({ one }) => ({
  user: one(user, {
    fields: [workspaceGitConfig.userId],
    references: [user.id],
  }),
  gitIntegration: one(gitIntegration, {
    fields: [workspaceGitConfig.gitIntegrationId],
    references: [gitIntegration.id],
  }),
}));

// Type exports
export type GitHubAppInstallation = typeof githubAppInstallation.$inferSelect;
export type NewGitHubAppInstallation = typeof githubAppInstallation.$inferInsert;
export type GitIntegration = typeof gitIntegration.$inferSelect;
export type NewGitIntegration = typeof gitIntegration.$inferInsert;
export type WorkspaceGitConfig = typeof workspaceGitConfig.$inferSelect;
export type NewWorkspaceGitConfig = typeof workspaceGitConfig.$inferInsert;
export type GitProvider = (typeof gitProviderEnum.enumValues)[number];

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { cloudProvider } from "./cloud";
import { modelProvider } from "./model-credentials";


export const cloudSession = pgTable("cloud_session", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    sandboxProviderId: uuid("sandbox_provider_id").references(() => cloudProvider.id, { onDelete: "cascade" }),
    modelProviderId: uuid("model_provider_id").notNull().references(() => modelProvider.id, { onDelete: "cascade" }),
    remoteRepoOwner: text("remote_repo_owner").notNull(),
    remoteRepoName: text("remote_repo_name").notNull(),
    remoteBranch: text("remote_branch").notNull(),
    sandboxId: text("sandbox_id"),
    opencodeSessionId: text("opencode_session_id"),
    serverUrl: text("server_url"),
    baseCommitSha: text("base_commit_sha").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

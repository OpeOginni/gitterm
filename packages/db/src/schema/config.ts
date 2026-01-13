import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { agentType } from "./cloud";
import { relations } from "drizzle-orm";

export const agentConfig = pgTable("agent_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  agentTypeId: uuid("agent_type_id")
    .notNull()
    .references(() => agentType.id, { onDelete: "cascade" }),
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentSkills = pgTable("agent_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  agentConfigId: uuid("agent_config_id")
    .notNull()
    .references(() => agentConfig.id, { onDelete: "cascade" }),
  skill: text("skill").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentInternalSubagents = pgTable("agent_internal_subagents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  agentConfigId: uuid("agent_config_id")
    .notNull()
    .references(() => agentConfig.id, { onDelete: "cascade" }),
  subagent: text("subagent").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentConfigRelations = relations(agentConfig, ({ one }) => ({
  user: one(user, {
    fields: [agentConfig.userId],
    references: [user.id],
  }),
  agentType: one(agentType, {
    fields: [agentConfig.agentTypeId],
    references: [agentType.id],
  }),
}));

export type AgentConfig = typeof agentConfig.$inferSelect;
export type NewAgentConfig = typeof agentConfig.$inferInsert;

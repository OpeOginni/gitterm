import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const ProjectTable = sqliteTable("project", {
  id: text("id").primaryKey(),
  userId: text("user_id"), // References User.id from packages/db (no FK - cross-database)
  worktree: text("worktree").notNull(),
  vcs: text("vcs"),
  name: text("name"),
  icon_url: text("icon_url"),
  icon_color: text("icon_color"),
  time_created: integer("time_created").notNull(),
  time_updated: integer("time_updated").notNull(),
  time_initialized: integer("time_initialized"),
  sandboxes: text("sandboxes", { mode: "json" }).notNull().$type<string[]>(),
})
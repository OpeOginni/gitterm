import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session"
type SessionShareInfo = {
    secret: string
    url: string
}

export const SessionShareTable = sqliteTable("session_share", {
  sessionID: text("session_id")
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  userId: text("user_id"), // References User.id from packages/db (no FK - cross-database)
  data: text("data", { mode: "json" }).notNull().$type<{
    id: string
    secret: string
    url: string
  }>(),
})

export const ShareTable = sqliteTable("share", {
  sessionID: text("session_id").primaryKey(),
  userId: text("user_id"), // References User.id from packages/db (no FK - cross-database)
  data: text("data", { mode: "json" }).notNull().$type<SessionShareInfo>(),
})

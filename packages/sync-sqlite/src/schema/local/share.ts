import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { LocalSessionTable } from "./session"
type SessionShareInfo = {
    secret: string
    url: string
}

export const SessionShareTable = sqliteTable("session_share", {
  sessionID: text("session_id")
    .primaryKey()
    .references(() => LocalSessionTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<{
    id: string
    secret: string
    url: string
  }>(),
})

export const ShareTable = sqliteTable("share", {
  sessionID: text("session_id").primaryKey(),
  data: text("data", { mode: "json" }).notNull().$type<SessionShareInfo>(),
})

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";


export const feedback = pgTable("feedback", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    feedback: text("feedback").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
})

export type FeedbackType = typeof feedback.$inferSelect;
export type NewFeedbackType = typeof feedback.$inferInsert;
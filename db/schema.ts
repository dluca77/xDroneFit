import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), name: text("name").notNull(),
  stateJson: text("state_json").notNull().default("{}"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
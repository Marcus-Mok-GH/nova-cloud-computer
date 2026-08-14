import { int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** A user's private, durable Nova work environment. */
export const workspaces = mysqlTable(
  "workspaces",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("workspaces_owner_unique").on(table.ownerId)],
);

/** A project groups related work inside one private workspace. */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** A task belongs to both its project and the project's workspace for reliable tenant scoping. */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 240 }).notNull(),
  notes: text("notes"),
  status: mysqlEnum("status", ["todo", "in_progress", "done"]).default("todo").notNull(),
  position: int("position").default(0).notNull(),
  dueAt: timestamp("dueAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;

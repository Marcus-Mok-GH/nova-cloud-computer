import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/** Internal Nova profile mapped one-to-one to the immutable Neon Auth subject. */
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);
export const modelProvider = pgEnum("model_provider", ["anthropic", "openai", "gemini", "custom"]);
export const modelCompatibility = pgEnum("model_compatibility", ["openai", "anthropic"]);
export const chatMessageRole = pgEnum("chat_message_role", ["user", "assistant"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Neon Auth UUID subject. The legacy column name is retained to minimize data-layer churn. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** A user's private, durable Nova work environment. */
export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("workspaces_owner_unique").on(table.ownerId)]);

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  status: projectStatus("status").default("active").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 240 }).notNull(),
  notes: text("notes"),
  status: taskStatus("status").default("todo").notNull(),
  position: integer("position").default(0).notNull(),
  dueAt: timestamp("dueAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

/** Private endpoint credentials are always encrypted before persistence. */
export const customModels = pgTable("custom_models", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  modelId: varchar("modelId", { length: 240 }).notNull(),
  baseUrl: varchar("baseUrl", { length: 2048 }).notNull(),
  compatibility: modelCompatibility("compatibility").notNull(),
  encryptedApiKey: text("encryptedApiKey").notNull(),
  supportsImageInput: boolean("supportsImageInput").default(false).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("custom_models_workspace_name_unique").on(table.workspaceId, table.name)]);

export const workspaceSettings = pgTable("workspace_settings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  activeProvider: modelProvider("activeProvider").default("anthropic").notNull(),
  activeModelId: varchar("activeModelId", { length: 240 }).default("claude-sonnet").notNull(),
  activeCustomModelId: integer("activeCustomModelId").references(() => customModels.id, { onDelete: "set null" }),
  workspaceRules: text("workspaceRules"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("workspace_settings_workspace_unique").on(table.workspaceId)]);

/** Folders form the user-managed, private directory tree within a Nova workspace. */
export const workspaceFolders = pgTable("workspace_folders", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  parentId: integer("parentId").references((): any => workspaceFolders.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("workspace_folders_parent_name_unique").on(table.workspaceId, table.parentId, table.name)]);

/** Text-first workspace files are durable, user-scoped documents that Nova can organize with permissioned actions. */
export const workspaceFiles = pgTable("workspace_files", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  folderId: integer("folderId").references(() => workspaceFolders.id, { onDelete: "set null" }),
  name: varchar("name", { length: 240 }).notNull(),
  content: text("content").default("").notNull(),
  mimeType: varchar("mimeType", { length: 120 }).default("text/plain").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("workspace_files_folder_name_unique").on(table.workspaceId, table.folderId, table.name)]);

/** A conversation is scoped to exactly one private Nova workspace. */
export const chats = pgTable("chats", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

/** Messages are persisted separately so every Nova conversation remains recoverable. */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chatId").notNull().references(() => chats.id, { onDelete: "cascade" }),
  role: chatMessageRole("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

/** Telegram Bot credentials are encrypted at rest and never returned to the browser. */
export const telegramBotSettings = pgTable("telegram_bot_settings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  encryptedBotToken: text("encryptedBotToken").notNull(),
  chatId: varchar("chatId", { length: 64 }),
  botUsername: varchar("botUsername", { length: 128 }),
  botDisplayName: varchar("botDisplayName", { length: 256 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("telegram_bot_settings_workspace_unique").on(table.workspaceId)]);

export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type CustomModel = typeof customModels.$inferSelect;
export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
export type WorkspaceFolder = typeof workspaceFolders.$inferSelect;
export type WorkspaceFile = typeof workspaceFiles.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type TelegramBotSettings = typeof telegramBotSettings.$inferSelect;

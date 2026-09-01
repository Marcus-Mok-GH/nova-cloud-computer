import { boolean, index, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/** Internal Nova profile mapped one-to-one to the immutable Neon Auth subject. */
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);
export const modelProvider = pgEnum("model_provider", ["anthropic", "openai", "gemini", "custom", "nvidia-nim"]);
export const modelCompatibility = pgEnum("model_compatibility", ["openai", "anthropic"]);
export const chatMessageRole = pgEnum("chat_message_role", ["user", "assistant"]);
export const agentVmRunStatus = pgEnum("agent_vm_run_status", ["queued", "running", "succeeded", "failed", "cancelled", "disabled"]);
export const automationKind = pgEnum("automation_kind", ["workspace_digest"]);
export const automationRunStatus = pgEnum("automation_run_status", ["running", "succeeded", "failed", "skipped"]);
export const userAutomationFrequency = pgEnum("user_automation_frequency", ["hourly", "daily", "weekdays", "weekly"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
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

export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  persistentSandboxId: varchar("persistentSandboxId", { length: 256 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("workspaces_owner_unique").on(table.ownerId)]);

export const projects = pgTable("projects", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), name: varchar("name", { length: 160 }).notNull(), description: text("description"), persistentSandboxId: varchar("persistentSandboxId", { length: 256 }), status: projectStatus("status").default("active").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() });
export const tasks = pgTable("tasks", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }), title: varchar("title", { length: 240 }).notNull(), notes: text("notes"), status: taskStatus("status").default("todo").notNull(), position: integer("position").default(0).notNull(), dueAt: timestamp("dueAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() });
export const customModels = pgTable("custom_models", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), name: varchar("name", { length: 120 }).notNull(), modelId: varchar("modelId", { length: 240 }).notNull(), baseUrl: varchar("baseUrl", { length: 2048 }).notNull(), compatibility: modelCompatibility("compatibility").notNull(), encryptedApiKey: text("encryptedApiKey").notNull(), supportsImageInput: boolean("supportsImageInput").default(false).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("custom_models_workspace_name_unique").on(table.workspaceId, table.name)]);
export const workspaceSettings = pgTable("workspace_settings", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), activeProvider: modelProvider("activeProvider").default("anthropic").notNull(), activeModelId: varchar("activeModelId", { length: 240 }).default("claude-sonnet").notNull(), activeCustomModelId: integer("activeCustomModelId").references(() => customModels.id, { onDelete: "set null" }), workspaceRules: text("workspaceRules"), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspace_settings_workspace_unique").on(table.workspaceId)]);
export const workspaceFolders = pgTable("workspace_folders", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), parentId: integer("parentId").references((): any => workspaceFolders.id, { onDelete: "cascade" }), name: varchar("name", { length: 160 }).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspace_folders_parent_name_unique").on(table.workspaceId, table.parentId, table.name)]);
export const workspaceFiles = pgTable("workspace_files", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), folderId: integer("folderId").references(() => workspaceFolders.id, { onDelete: "set null" }), name: varchar("name", { length: 240 }).notNull(), content: text("content").default("").notNull(), mimeType: varchar("mimeType", { length: 120 }).default("text/plain").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspace_files_folder_name_unique").on(table.workspaceId, table.folderId, table.name)]);
export const chats = pgTable("chats", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), title: varchar("title", { length: 160 }).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() });
export const chatMessages = pgTable("chat_messages", { id: serial("id").primaryKey(), chatId: integer("chatId").notNull().references(() => chats.id, { onDelete: "cascade" }), role: chatMessageRole("role").notNull(), content: text("content").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() });
export const telegramBotSettings = pgTable("telegram_bot_settings", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), encryptedBotToken: text("encryptedBotToken").notNull(), chatId: varchar("chatId", { length: 64 }), botUsername: varchar("botUsername", { length: 128 }), botDisplayName: varchar("botDisplayName", { length: 256 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("telegram_bot_settings_workspace_unique").on(table.workspaceId)]);
export const nvidiaInferenceAllowances = pgTable("nvidia_inference_allowances", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), usedRequests: integer("usedRequests").default(0).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("nvidia_inference_allowances_workspace_unique").on(table.workspaceId)]);
export const agentVmRuns = pgTable("agent_vm_runs", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), provider: varchar("provider", { length: 32 }).default("daytona").notNull(), sandboxId: varchar("sandboxId", { length: 256 }), task: text("task").notNull(), status: agentVmRunStatus("status").default("queued").notNull(), resultSummary: text("resultSummary"), errorMessage: varchar("errorMessage", { length: 1200 }), artifactFileId: integer("artifactFileId").references(() => workspaceFiles.id, { onDelete: "set null" }), startedAt: timestamp("startedAt", { withTimezone: true }), completedAt: timestamp("completedAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [index("agent_vm_runs_workspace_created_idx").on(table.workspaceId, table.createdAt)]);
export const automations = pgTable("automations", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), kind: automationKind("kind").default("workspace_digest").notNull(), enabled: boolean("enabled").default(false).notNull(), scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(), lastRunAt: timestamp("lastRunAt", { withTimezone: true }), lastError: varchar("lastError", { length: 1200 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("automations_workspace_kind_unique").on(table.workspaceId, table.kind), index("automations_owner_enabled_idx").on(table.ownerId, table.enabled)]);
export const automationRuns = pgTable("automation_runs", { id: serial("id").primaryKey(), automationId: integer("automationId").notNull().references(() => automations.id, { onDelete: "cascade" }), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), runKey: varchar("runKey", { length: 96 }).notNull(), status: automationRunStatus("status").default("running").notNull(), summary: text("summary"), errorMessage: varchar("errorMessage", { length: 1200 }), artifactFileId: integer("artifactFileId").references(() => workspaceFiles.id, { onDelete: "set null" }), startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(), completedAt: timestamp("completedAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("automation_runs_automation_run_key_unique").on(table.automationId, table.runKey), index("automation_runs_owner_created_idx").on(table.ownerId, table.createdAt)]);

/** Automations created and scheduled directly by the user. */
export const userAutomations = pgTable("user_automations", {
  id: serial("id").primaryKey(),
  ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  instructions: text("instructions").notNull(),
  frequency: userAutomationFrequency("frequency").default("daily").notNull(),
  scheduleCron: varchar("scheduleCron", { length: 64 }).notNull(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(),
  enabled: boolean("enabled").default(false).notNull(),
  lastRunAt: timestamp("lastRunAt", { withTimezone: true }),
  lastError: varchar("lastError", { length: 1200 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("user_automations_owner_idx").on(table.ownerId, table.createdAt)]);

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
export type NvidiaInferenceAllowance = typeof nvidiaInferenceAllowances.$inferSelect;
export type AgentVmRun = typeof agentVmRuns.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type UserAutomation = typeof userAutomations.$inferSelect;

import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/** Internal Nova profile mapped one-to-one to the immutable Neon Auth subject. */
export const userRole = pgEnum("user_role", ["user", "admin", "developer"]);
export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);
// "mistral" is the legacy stored identifier for Nova's built-in AI gateway.
export const modelProvider = pgEnum("model_provider", ["anthropic", "openai", "gemini", "custom", "mistral"]);
export const modelCompatibility = pgEnum("model_compatibility", ["openai", "anthropic"]);
export const chatMessageRole = pgEnum("chat_message_role", ["user", "assistant"]);
export const agentVmRunStatus = pgEnum("agent_vm_run_status", ["queued", "running", "succeeded", "failed", "cancelled", "disabled"]);
export const automationKind = pgEnum("automation_kind", ["workspace_digest"]);
export const automationRunStatus = pgEnum("automation_run_status", ["running", "succeeded", "failed", "skipped"]);
export const userAutomationFrequency = pgEnum("user_automation_frequency", ["hourly", "daily", "weekdays", "weekly", "custom"]);
export const siteDeploymentStatus = pgEnum("site_deployment_status", ["deploying", "live", "failed", "deleted"]);
/** Ledger of segmented agent runs: one row per user message that starts agent work. */
export const agentRunStatus = pgEnum("agent_run_status", ["running", "awaiting_continue", "completed", "stopped", "failed"]);
/** One deferred request admitted to the peak-hours inference queue. */
export const inferenceQueueStatus = pgEnum("inference_queue_status", ["waiting", "running", "completed", "failed", "cancelled"]);
/** Lifecycle of an agent action the user must confirm: pending review, executed (approved and carried out), denied (declined), or failed (approved but not carried out, e.g. the wallet ran out of budget). */
export const agentApprovalStatus = pgEnum("agent_approval_status", ["pending", "executed", "denied", "failed"]);

export const users = pgTable("users", { id: serial("id").primaryKey(), openId: varchar("openId", { length: 64 }).notNull().unique(), name: text("name"), email: varchar("email", { length: 320 }), loginMethod: varchar("loginMethod", { length: 64 }), role: userRole("role").default("user").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(), lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(), bannedAt: timestamp("bannedAt", { withTimezone: true }), username: varchar("username", { length: 64 }).unique() });
export type User = typeof users.$inferSelect; export type InsertUser = typeof users.$inferInsert;
export const workspaces = pgTable("workspaces", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), name: varchar("name", { length: 120 }).notNull(), description: text("description"), persistentSandboxId: varchar("persistentSandboxId", { length: 256 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspaces_owner_unique").on(table.ownerId)]);
export const projects = pgTable("projects", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), name: varchar("name", { length: 160 }).notNull(), description: text("description"), persistentSandboxId: varchar("persistentSandboxId", { length: 256 }), status: projectStatus("status").default("active").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() });
export const tasks = pgTable("tasks", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }), title: varchar("title", { length: 240 }).notNull(), notes: text("notes"), status: taskStatus("status").default("todo").notNull(), position: integer("position").default(0).notNull(), dueAt: timestamp("dueAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() });
export const customModels = pgTable("custom_models", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), name: varchar("name", { length: 120 }).notNull(), modelId: varchar("modelId", { length: 240 }).notNull(), baseUrl: varchar("baseUrl", { length: 2048 }).notNull(), compatibility: modelCompatibility("compatibility").notNull(), encryptedApiKey: text("encryptedApiKey").notNull(), supportsImageInput: boolean("supportsImageInput").default(false).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("custom_models_workspace_name_unique").on(table.workspaceId, table.name)]);
export const workspaceSettings = pgTable("workspace_settings", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), activeProvider: modelProvider("activeProvider").default("anthropic").notNull(), activeModelId: varchar("activeModelId", { length: 240 }).default("claude-sonnet").notNull(), activeCustomModelId: integer("activeCustomModelId").references(() => customModels.id, { onDelete: "set null" }), workspaceRules: text("workspaceRules"), communicationStyle: text("communicationStyle"), // Personalisation mode: whether Nova learns lasting preferences, the
// distilled profile built by the guided setup, and the structured knobs.
personalisationEnabled: boolean("personalisationEnabled").default(false).notNull(), personalisationProfile: text("personalisationProfile"), personalisationTone: varchar("personalisationTone", { length: 60 }), personalisationDetail: varchar("personalisationDetail", { length: 20 }), personalisationProactiveness: varchar("personalisationProactiveness", { length: 20 }), personalisationExpertise: varchar("personalisationExpertise", { length: 20 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspace_settings_workspace_unique").on(table.workspaceId)]);
export const workspaceFolders = pgTable("workspace_folders", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), parentId: integer("parentId").references((): any => workspaceFolders.id, { onDelete: "cascade" }), name: varchar("name", { length: 160 }).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspace_folders_parent_name_unique").on(table.workspaceId, table.parentId, table.name)]);
export const workspaceFiles = pgTable("workspace_files", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), folderId: integer("folderId").references(() => workspaceFolders.id, { onDelete: "set null" }), name: varchar("name", { length: 240 }).notNull(), content: text("content").default("").notNull(), mimeType: varchar("mimeType", { length: 120 }).default("text/plain").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("workspace_files_folder_name_unique").on(table.workspaceId, table.folderId, table.name)]);
export const chats = pgTable("chats", {
  id: varchar("id", { length: 24 }).primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  /** "personal" - an ordinary Nova conversation or a 1:1 chat with one agent. "team" - a group chat where several agents collaborate toward teamGoal. */
  kind: varchar("kind", { length: 16 }).default("personal").notNull(),
  /** The agent this personal conversation belongs to; null for ordinary Nova chats. */
  agentId: integer("agentId").references((): any => agentProfiles.id, { onDelete: "set null" }),
  /** The shared goal an agent team chat works toward. */
  teamGoal: text("teamGoal"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});
export const chatMessages = pgTable("chat_messages", { id: serial("id").primaryKey(), chatId: varchar("chatId", { length: 24 }).notNull().references(() => chats.id, { onDelete: "cascade" }), role: chatMessageRole("role").notNull(), content: text("content").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() });
export const conversationMemories = pgTable("conversation_memories", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), chatId: varchar("chatId", { length: 24 }).references(() => chats.id, { onDelete: "cascade" }),
  /** The agent this memory belongs to; null = the workspace's shared (default Nova) memory scope. Each personal agent remembers on its own. */
  agentId: integer("agentId").references((): any => agentProfiles.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).default("conversation").notNull(), title: varchar("title", { length: 300 }).notNull(), summary: text("summary").notNull(), tags: varchar("tags", { length: 500 }), content: text("content").notNull(), s3Uri: varchar("s3Uri", { length: 500 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [index("conversation_memories_owner_updated_idx").on(table.ownerId, table.updatedAt)]);
export const telegramBotSettings = pgTable("telegram_bot_settings", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), encryptedBotToken: text("encryptedBotToken").notNull(), chatId: varchar("chatId", { length: 64 }), botUsername: varchar("botUsername", { length: 128 }), botDisplayName: varchar("botDisplayName", { length: 256 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("telegram_bot_settings_workspace_unique").on(table.workspaceId)]);
export const apiKeys = pgTable("api_keys", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), name: varchar("name", { length: 120 }).notNull(), keyHash: varchar("keyHash", { length: 64 }).notNull().unique(), keyPreview: varchar("keyPreview", { length: 40 }).notNull(), lastUsedAt: timestamp("lastUsedAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [index("api_keys_owner_idx").on(table.ownerId)]);
// Legacy physical table/index names for the built-in gateway's allowances.
export const inferenceAllowances = pgTable("mistral_inference_allowances", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), usedRequests: integer("usedRequests").default(0).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("mistral_inference_allowances_workspace_unique").on(table.workspaceId)]);
export const dailyCredits = pgTable("daily_credits", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), creditDay: varchar("creditDay", { length: 10 }).notNull(), region: varchar("region", { length: 32 }).default("global").notNull(), allocatedCredits: integer("allocatedCredits").notNull(), usedCredits: integer("usedCredits").default(0).notNull(), inputTokens: integer("inputTokens").default(0).notNull(), outputTokens: integer("outputTokens").default(0).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("daily_credits_owner_day_unique").on(table.ownerId, table.creditDay), index("daily_credits_owner_day_idx").on(table.ownerId, table.creditDay)]);
export const agentVmRuns = pgTable("agent_vm_runs", { id: serial("id").primaryKey(), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), provider: varchar("provider", { length: 32 }).default("e2b").notNull(), sandboxId: varchar("sandboxId", { length: 256 }), task: text("task").notNull(), status: agentVmRunStatus("status").default("queued").notNull(), resultSummary: text("resultSummary"), errorMessage: varchar("errorMessage", { length: 1200 }), artifactFileId: integer("artifactFileId").references(() => workspaceFiles.id, { onDelete: "set null" }), chatId: varchar("chatId", { length: 24 }), startedAt: timestamp("startedAt", { withTimezone: true }), completedAt: timestamp("completedAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [index("agent_vm_runs_workspace_created_idx").on(table.workspaceId, table.createdAt)]);
export const automations = pgTable("automations", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), kind: automationKind("kind").default("workspace_digest").notNull(), enabled: boolean("enabled").default(false).notNull(), scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(), lastRunAt: timestamp("lastRunAt", { withTimezone: true }), lastError: varchar("lastError", { length: 1200 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("automations_workspace_kind_unique").on(table.workspaceId, table.kind), index("automations_owner_enabled_idx").on(table.ownerId, table.enabled)]);
export const automationRuns = pgTable("automation_runs", { id: serial("id").primaryKey(), automationId: integer("automationId").notNull().references(() => automations.id, { onDelete: "cascade" }), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }), runKey: varchar("runKey", { length: 96 }).notNull(), status: automationRunStatus("status").default("running").notNull(), summary: text("summary"), errorMessage: varchar("errorMessage", { length: 1200 }), artifactFileId: integer("artifactFileId").references(() => workspaceFiles.id, { onDelete: "set null" }), startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(), completedAt: timestamp("completedAt", { withTimezone: true }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() }, table => [uniqueIndex("automation_runs_automation_run_key_unique").on(table.automationId, table.runKey), index("automation_runs_owner_created_idx").on(table.ownerId, table.createdAt)]);

/** Automations created from a natural-language request and compiled into an executable definition. */
export const userAutomations = pgTable("user_automations", {
  id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(), instructions: text("instructions").notNull(), frequency: userAutomationFrequency("frequency").default("daily").notNull(), scheduleCron: varchar("scheduleCron", { length: 64 }).notNull(), scheduleTimezone: varchar("scheduleTimezone", { length: 80 }).default("UTC").notNull(), executionPrompt: text("executionPrompt").notNull(), args: jsonb("args").$type<Record<string, unknown>>().default({}).notNull(), definition: jsonb("definition").$type<Record<string, unknown>>().default({}).notNull(), scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }).unique(), enabled: boolean("enabled").default(false).notNull(), lastRunAt: timestamp("lastRunAt", { withTimezone: true }), lastError: varchar("lastError", { length: 1200 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("user_automations_owner_idx").on(table.ownerId, table.createdAt)]);

/**
 * A one-time purchase of priority queue placement. The row holds one account's
 * most recent purchase. Buying *arms* it (`activatedAt` NULL); the one-hour
 * window (see PRIORITY_DURATION_MS in server/db.ts) starts only when the
 * account next sends a message, and runs from `activatedAt`. While the window
 * is open the account's requests are served ahead of standard ones whenever the
 * peak-hours queue is active. Buying again re-arms the purchase, so the next
 * message starts a fresh hour.
 */
export const priorityPurchases = pgTable("priority_purchases", {
  id: serial("id").primaryKey(),
  ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  purchasedAt: timestamp("purchasedAt", { withTimezone: true }).defaultNow().notNull(),
  activatedAt: timestamp("activatedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("priority_purchases_owner_unique").on(table.ownerId)]);
export type PriorityPurchase = typeof priorityPurchases.$inferSelect;

/** Webhook update ids Nova has already handled - dedupes Telegram redeliveries. */
export const telegramUpdateLog = pgTable("telegram_update_log", { updateId: bigint("updateId", { mode: "number" }).primaryKey(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() });
export const agentStopRequests = pgTable("agent_stop_requests", { id: serial("id").primaryKey(), ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }), chatId: varchar("chatId", { length: 24 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() }, table => [index("agent_stop_requests_owner_idx").on(table.ownerId, table.createdAt)]);
export type Workspace = typeof workspaces.$inferSelect; export type Project = typeof projects.$inferSelect; export type Task = typeof tasks.$inferSelect; export type CustomModel = typeof customModels.$inferSelect; export type WorkspaceSettings = typeof workspaceSettings.$inferSelect; export type WorkspaceFolder = typeof workspaceFolders.$inferSelect; export type WorkspaceFile = typeof workspaceFiles.$inferSelect; export type Chat = typeof chats.$inferSelect; export type ChatMessage = typeof chatMessages.$inferSelect; export type ConversationMemory = typeof conversationMemories.$inferSelect; export type TelegramBotSettings = typeof telegramBotSettings.$inferSelect; export type ApiKey = typeof apiKeys.$inferSelect; export type InferenceAllowance = typeof inferenceAllowances.$inferSelect; export type DailyCredit = typeof dailyCredits.$inferSelect; export type AgentVmRun = typeof agentVmRuns.$inferSelect; export type AgentStopRequest = typeof agentStopRequests.$inferSelect; export type TelegramUpdateLog = typeof telegramUpdateLog.$inferSelect; export type Automation = typeof automations.$inferSelect; export type AutomationRun = typeof automationRuns.$inferSelect; export type UserAutomation = typeof userAutomations.$inferSelect;

export const siteDeployments = pgTable("site_deployments", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  siteId: varchar("siteId", { length: 64 }).notNull(),
  siteName: varchar("siteName", { length: 160 }),
  siteUrl: varchar("siteUrl", { length: 512 }).notNull(),
  /** Stable short ID the agent targets a site by, e.g. 'd-01'. Shared by every run row of the same site. */
  deploymentKey: varchar("deploymentKey", { length: 16 }),
  /** Short description of what this deployment is, written by the agent at creation. */
  description: varchar("description", { length: 240 }),
  status: siteDeploymentStatus("status").default("deploying").notNull(),
  fileCount: integer("fileCount").default(0).notNull(),
  error: varchar("error", { length: 1200 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("site_deployments_workspace_created_idx").on(table.workspaceId, table.createdAt)]);

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  chatId: varchar("chatId", { length: 24 }).notNull().references(() => chats.id, { onDelete: "cascade" }),
  channel: varchar("channel", { length: 32 }).default("telegram").notNull(),
  status: agentRunStatus("status").default("running").notNull(),
  segment: integer("segment").default(0).notNull(),
  notifyChatId: varchar("notifyChatId", { length: 64 }),
  errorMessage: varchar("errorMessage", { length: 1200 }),
  startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("agent_runs_workspace_status_idx").on(table.workspaceId, table.status), index("agent_runs_chat_idx").on(table.chatId)]);

/** Payload a deferred queue item needs to run after it leaves the queue. */
export type InferenceQueuePayload = {
  /** Web/Telegram: attachment context appended to the agent turn but hidden from the bubble. */
  uploadContext?: string;
  /** Web/Telegram: base64 image attachments for the run. */
  images?: string[];
  /** Telegram: the chat id the deferred reply is pushed to. */
  notifyChatId?: string;
  /** Inference API: the requested model id. */
  modelId?: string;
  /** Inference API: the BYOK row selected at admission, so a later active-model change cannot reroute the request. */
  customModelId?: number | null;
  /** Inference API: the normalized OpenAI-style messages to complete. */
  messages?: unknown[];
  /** Inference API: whether the caller asked for a streamed response. */
  stream?: boolean;
};

/**
 * A single FIFO queue for messages that arrive during the peak window. The
 * worker admits one row at a time (status running) so the shared inference
 * pool is never saturated; every other row waits and can read its position.
 */
export const inferenceQueue = pgTable("inference_queue", {
  id: serial("id").primaryKey(),
  ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** "web", "telegram", or "api" - how the deferred result is delivered. */
  channel: varchar("channel", { length: 32 }).notNull(),
  status: inferenceQueueStatus("status").default("waiting").notNull(),
  chatId: varchar("chatId", { length: 24 }).references(() => chats.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  payload: jsonb("payload").$type<InferenceQueuePayload>().default({}).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorMessage: varchar("errorMessage", { length: 1200 }),
  /** Claims so far; a stale sweep stops retrying a row once it hits the cap. */
  attempts: integer("attempts").default(0).notNull(),
  /** Denormalized billing priority at admission; priority rows are claimed first. */
  priority: boolean("priority").default(false).notNull(),
  startedAt: timestamp("startedAt", { withTimezone: true }),
  completedAt: timestamp("completedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("inference_queue_status_id_idx").on(table.status, table.id), index("inference_queue_owner_status_idx").on(table.ownerId, table.status)]);
export type InferenceQueueItem = typeof inferenceQueue.$inferSelect;

/**
 * A personal agent in a workspace - Nova's Cue-style agent identity. Each
 * agent carries its own name/role/instructions, a Nova-native identity (an
 * internal email alias and a virtual phone handle), and a spending wallet the
 * user tops up as a credit budget. Agents chat in 1:1 conversations and in
 * team chats (see chats.kind / chat_agents).
 */
export const agentProfiles = pgTable("agent_profiles", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  role: varchar("role", { length: 120 }),
  instructions: text("instructions"),
  /** Nova-internal mail address, e.g. `mira-4f2a@nova.local`. */
  emailAlias: varchar("emailAlias", { length: 160 }).notNull(),
  /** Virtual phone handle, e.g. `+1-555-0142` (a handle, not real telephony). */
  phoneHandle: varchar("phoneHandle", { length: 40 }).notNull(),
  /** Spending budget in workspace credits the user grants this agent. */
  walletBudgetCredits: integer("walletBudgetCredits").default(500).notNull(),
  /** Credits spent from approved purchases. Remaining = budget - spent. */
  walletSpentCredits: integer("walletSpentCredits").default(0).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("agent_profiles_workspace_name_unique").on(table.workspaceId, table.name),
  uniqueIndex("agent_profiles_workspace_alias_unique").on(table.workspaceId, table.emailAlias),
]);
export type AgentProfileRow = typeof agentProfiles.$inferSelect;

/** Membership of an agent in a team chat, in turn order. */
export const chatAgents = pgTable("chat_agents", {
  id: serial("id").primaryKey(),
  chatId: varchar("chatId", { length: 24 }).notNull().references(() => chats.id, { onDelete: "cascade" }),
  agentId: integer("agentId").notNull().references(() => agentProfiles.id, { onDelete: "cascade" }),
  /** Roster order: teammates take their turn in this order. */
  position: integer("position").default(0).notNull(),
}, table => [uniqueIndex("chat_agents_chat_agent_unique").on(table.chatId, table.agentId)]);
export type ChatAgentRow = typeof chatAgents.$inferSelect;

/**
 * An agent action awaiting (or having received) the user's confirmation:
 * wallet purchases and outbound agent email are always gated this way. The
 * approval row doubles as the wallet's transaction history.
 */
export const agentApprovals = pgTable("agent_approvals", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerId: integer("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: integer("agentId").notNull().references(() => agentProfiles.id, { onDelete: "cascade" }),
  /** The chat the request was made from; null when the chat was deleted. */
  chatId: varchar("chatId", { length: 24 }).references(() => chats.id, { onDelete: "set null" }),
  /** "wallet_purchase" | "send_email" - which gated action this is. */
  action: varchar("action", { length: 32 }).notNull(),
  /** Action-specific payload: purchase {item, amountCredits, note?} / email {to, subject, body}. */
  params: jsonb("params").$type<Record<string, unknown>>().default({}).notNull(),
  status: agentApprovalStatus("status").default("pending").notNull(),
  /** Outcome text the agent and user see once decided. */
  resultSummary: text("resultSummary"),
  decidedAt: timestamp("decidedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index("agent_approvals_owner_status_idx").on(table.ownerId, table.status),
  index("agent_approvals_agent_status_idx").on(table.agentId, table.status),
]);
export type AgentApprovalRow = typeof agentApprovals.$inferSelect;

/** Nova-internal mail between agents (or from an agent to the workspace owner). */
export const agentEmails = pgTable("agent_emails", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  fromAgentId: integer("fromAgentId").notNull().references(() => agentProfiles.id, { onDelete: "cascade" }),
  /** Receiving agent; null = the workspace owner (the user's own inbox). */
  toAgentId: integer("toAgentId").references((): any => agentProfiles.id, { onDelete: "set null" }),
  subject: varchar("subject", { length: 240 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("agent_emails_workspace_created_idx").on(table.workspaceId, table.createdAt)]);
export type AgentEmailRow = typeof agentEmails.$inferSelect;

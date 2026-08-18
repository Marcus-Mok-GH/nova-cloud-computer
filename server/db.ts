import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import {
  chatMessages,
  chats,
  customModels,
  InsertUser,
  projects,
  tasks,
  users,
  workspaces,
  workspaceFiles,
  workspaceFolders,
  workspaceSettings,
  telegramBotSettings,
  nvidiaInferenceAllowances,
  agentVmRuns,
  automations,
  automationRuns,
} from "../drizzle/schema";
import { decryptPrivateCredential, encryptModelApiKey, encryptPrivateCredential } from "./modelSecrets";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(neon(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to initialize Neon:", error);
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The Nova database is unavailable.");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("Neon Auth subject is required for upsert.");
  const db = await requireDb();
  await db.insert(users).values({
    openId: user.openId,
    name: user.name ?? null,
    email: user.email ?? null,
    loginMethod: user.loginMethod ?? "neon_magic_link",
    role: user.role ?? "user",
    lastSignedIn: user.lastSignedIn ?? new Date(),
  }).onConflictDoUpdate({
    target: users.openId,
    set: {
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? "neon_magic_link",
      lastSignedIn: user.lastSignedIn ?? new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await requireDb();
  return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
}

export async function deleteUserAccount(userId: number): Promise<boolean> {
  const db = await requireDb();
  // Note: This deletes the local user record and associated workspace data via cascade.
  // The external Neon Auth identity (managed by Neon's Better Auth service) is not
  // automatically deleted because the Neon Auth Admin API does not currently expose
  // a deleteUser method. Users who need to fully remove their authentication identity
  // should contact Neon support or use the Neon Console to manually delete the auth user.
  // Reference: https://neon.com/docs/auth/guides/plugins/admin (Admin plugin methods)
  const [deleted] = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return Boolean(deleted);
}

export async function getOrCreateWorkspace(ownerId: number) {
  const db = await requireDb();
  const existing = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(workspaces).values({ ownerId, name: "My Nova Space" }).onConflictDoNothing();
  const created = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  if (!created[0]) throw new Error("Nova could not create a workspace.");
  return created[0];
}

type ActiveProvider = "anthropic" | "openai" | "gemini" | "custom";
type ModelCompatibility = "openai" | "anthropic";

function toSafeCustomModel(model: typeof customModels.$inferSelect) {
  const { encryptedApiKey: _encryptedApiKey, ...safeModel } = model;
  return { ...safeModel, hasApiKey: true };
}

async function getOrCreateWorkspaceSettings(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const existing = await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspace.id)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(workspaceSettings).values({ workspaceId: workspace.id }).onConflictDoNothing();
  const created = await db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspace.id)).limit(1);
  if (!created[0]) throw new Error("Nova could not create workspace settings.");
  return created[0];
}

export async function listCustomModelsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(customModels).where(eq(customModels.workspaceId, workspace.id)).orderBy(asc(customModels.createdAt))).map(toSafeCustomModel);
}

async function getCustomModelForUser(ownerId: number, customModelId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(customModels).where(and(eq(customModels.id, customModelId), eq(customModels.workspaceId, workspace.id))).limit(1))[0];
}

export async function createCustomModelForUser(ownerId: number, input: { name: string; modelId: string; baseUrl: string; compatibility: ModelCompatibility; apiKey: string; supportsImageInput: boolean }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [created] = await db.insert(customModels).values({
    workspaceId: workspace.id,
    name: input.name,
    modelId: input.modelId,
    baseUrl: input.baseUrl,
    compatibility: input.compatibility,
    encryptedApiKey: encryptModelApiKey(input.apiKey),
    supportsImageInput: input.supportsImageInput,
  }).returning();
  if (!created) throw new Error("Nova could not save the custom model.");
  return toSafeCustomModel(created);
}

export async function deleteCustomModelForUser(ownerId: number, customModelId: number) {
  const db = await requireDb();
  const model = await getCustomModelForUser(ownerId, customModelId);
  if (!model) return false;
  await db.delete(customModels).where(eq(customModels.id, model.id));
  const settings = await getOrCreateWorkspaceSettings(ownerId);
  if (settings.activeCustomModelId === model.id) {
    await db.update(workspaceSettings).set({ activeProvider: "anthropic", activeModelId: "claude-sonnet", activeCustomModelId: null, updatedAt: new Date() }).where(eq(workspaceSettings.id, settings.id));
  }
  return true;
}

export async function getWorkspaceModelSettingsForUser(ownerId: number) {
  const [settings, models] = await Promise.all([getOrCreateWorkspaceSettings(ownerId), listCustomModelsForUser(ownerId)]);
  return { ...settings, customModels: models };
}

export async function updateWorkspaceModelSettingsForUser(ownerId: number, input: { activeProvider?: ActiveProvider; activeModelId?: string; activeCustomModelId?: number | null; workspaceRules?: string | null }) {
  const db = await requireDb();
  const settings = await getOrCreateWorkspaceSettings(ownerId);
  const updateSet: Partial<typeof workspaceSettings.$inferInsert> = { updatedAt: new Date() };
  if (input.activeCustomModelId !== undefined && input.activeCustomModelId !== null) {
    const model = await getCustomModelForUser(ownerId, input.activeCustomModelId);
    if (!model) return undefined;
    updateSet.activeCustomModelId = model.id;
    if (input.activeProvider === "custom") updateSet.activeModelId = model.modelId;
  } else if (input.activeCustomModelId === null) updateSet.activeCustomModelId = null;
  if (input.activeProvider === "custom" && (input.activeCustomModelId ?? settings.activeCustomModelId) === null) return undefined;
  if (input.activeProvider !== undefined) updateSet.activeProvider = input.activeProvider;
  if (input.activeModelId !== undefined) updateSet.activeModelId = input.activeModelId;
  if (input.workspaceRules !== undefined) updateSet.workspaceRules = input.workspaceRules;
  if (Object.keys(updateSet).length === 1) return getWorkspaceModelSettingsForUser(ownerId);
  await db.update(workspaceSettings).set(updateSet).where(eq(workspaceSettings.id, settings.id));
  return getWorkspaceModelSettingsForUser(ownerId);
}

export async function listProjectsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(projects).where(eq(projects.workspaceId, workspace.id)).orderBy(asc(projects.createdAt));
}

export async function createProjectForUser(ownerId: number, input: { name: string; description?: string | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.insert(projects).values({ workspaceId: workspace.id, name: input.name, description: input.description ?? null }).returning())[0];
}

export async function getProjectForUser(ownerId: number, projectId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id))).limit(1))[0];
}

export async function deleteProjectForUser(ownerId: number, projectId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [deleted] = await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id))).returning({ id: projects.id });
  return Boolean(deleted);
}

export async function updateProjectForUser(ownerId: number, projectId: number, input: { name?: string; description?: string | null; status?: "active" | "archived" }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const updateSet: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.description !== undefined) updateSet.description = input.description;
  if (input.status !== undefined) updateSet.status = input.status;
  return (await db.update(projects).set(updateSet).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id))).returning())[0];
}

export async function listTasksForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(tasks).where(eq(tasks.workspaceId, workspace.id)).orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.createdAt));
}

export async function createTaskForUser(ownerId: number, input: { projectId: number; title: string; notes?: string | null; dueAt?: Date | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const project = await getProjectForUser(ownerId, input.projectId);
  if (!project) return undefined;
  return (await db.insert(tasks).values({ workspaceId: workspace.id, projectId: project.id, title: input.title, notes: input.notes ?? null, dueAt: input.dueAt ?? null }).returning())[0];
}

export async function updateTaskStatusForUser(ownerId: number, taskId: number, status: "todo" | "in_progress" | "done") {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.update(tasks).set({ status, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspace.id))).returning())[0];
}

export async function deleteTaskForUser(ownerId: number, taskId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [deleted] = await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspace.id))).returning({ id: tasks.id });
  return Boolean(deleted);
}

export async function getWorkspaceDashboard(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const [projectRows, taskRows, settings] = await Promise.all([listProjectsForUser(ownerId), listTasksForUser(ownerId), getWorkspaceModelSettingsForUser(ownerId)]);
  return { workspace, projects: projectRows, tasks: taskRows, settings };
}

async function getFolderForUser(ownerId: number, folderId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(workspaceFolders).where(and(
    eq(workspaceFolders.id, folderId),
    eq(workspaceFolders.workspaceId, workspace.id),
  )).limit(1))[0];
}

async function getFileForUser(ownerId: number, fileId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(workspaceFiles).where(and(
    eq(workspaceFiles.id, fileId),
    eq(workspaceFiles.workspaceId, workspace.id),
  )).limit(1))[0];
}

async function getChatForUser(ownerId: number, chatId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(chats).where(and(
    eq(chats.id, chatId),
    eq(chats.workspaceId, workspace.id),
  )).limit(1))[0];
}

export async function listWorkspaceFoldersForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(workspaceFolders).where(eq(workspaceFolders.workspaceId, workspace.id)).orderBy(asc(workspaceFolders.name));
}

export async function createWorkspaceFolderForUser(ownerId: number, input: { name: string; parentId?: number | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  if (input.parentId) {
    const parent = await getFolderForUser(ownerId, input.parentId);
    if (!parent) return undefined;
  }
  return (await db.insert(workspaceFolders).values({
    workspaceId: workspace.id,
    name: input.name,
    parentId: input.parentId ?? null,
  }).returning())[0];
}

export async function updateWorkspaceFolderForUser(ownerId: number, folderId: number, input: { name?: string; parentId?: number | null }) {
  const db = await requireDb();
  const folder = await getFolderForUser(ownerId, folderId);
  if (!folder) return undefined;
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === folder.id) return undefined;
    const parent = await getFolderForUser(ownerId, input.parentId);
    if (!parent) return undefined;
  }
  const updateSet: Partial<typeof workspaceFolders.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.parentId !== undefined) updateSet.parentId = input.parentId;
  return (await db.update(workspaceFolders).set(updateSet).where(eq(workspaceFolders.id, folder.id)).returning())[0];
}

export async function deleteWorkspaceFolderForUser(ownerId: number, folderId: number) {
  const db = await requireDb();
  const folder = await getFolderForUser(ownerId, folderId);
  if (!folder) return false;
  await db.delete(workspaceFolders).where(eq(workspaceFolders.id, folder.id));
  return true;
}

export async function listWorkspaceFilesForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(workspaceFiles).where(eq(workspaceFiles.workspaceId, workspace.id)).orderBy(desc(workspaceFiles.updatedAt));
}

export async function createWorkspaceFileForUser(ownerId: number, input: { name: string; content?: string; mimeType?: string; folderId?: number | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  if (input.folderId) {
    const folder = await getFolderForUser(ownerId, input.folderId);
    if (!folder) return undefined;
  }
  return (await db.insert(workspaceFiles).values({
    workspaceId: workspace.id,
    name: input.name,
    content: input.content ?? "",
    mimeType: input.mimeType ?? "text/plain",
    folderId: input.folderId ?? null,
  }).returning())[0];
}

export async function updateWorkspaceFileForUser(ownerId: number, fileId: number, input: { name?: string; content?: string; folderId?: number | null }) {
  const db = await requireDb();
  const file = await getFileForUser(ownerId, fileId);
  if (!file) return undefined;
  if (input.folderId !== undefined && input.folderId !== null) {
    const folder = await getFolderForUser(ownerId, input.folderId);
    if (!folder) return undefined;
  }
  const updateSet: Partial<typeof workspaceFiles.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.content !== undefined) updateSet.content = input.content;
  if (input.folderId !== undefined) updateSet.folderId = input.folderId;
  return (await db.update(workspaceFiles).set(updateSet).where(eq(workspaceFiles.id, file.id)).returning())[0];
}

export async function deleteWorkspaceFileForUser(ownerId: number, fileId: number) {
  const db = await requireDb();
  const file = await getFileForUser(ownerId, fileId);
  if (!file) return false;
  await db.delete(workspaceFiles).where(eq(workspaceFiles.id, file.id));
  return true;
}

export async function listChatsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(chats).where(eq(chats.workspaceId, workspace.id)).orderBy(desc(chats.updatedAt));
}

export async function createChatForUser(ownerId: number, title: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.insert(chats).values({ workspaceId: workspace.id, title }).returning())[0];
}

export async function listChatMessagesForUser(ownerId: number, chatId: number) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  return db.select().from(chatMessages).where(eq(chatMessages.chatId, chat.id)).orderBy(asc(chatMessages.createdAt));
}

export async function appendChatMessageForUser(ownerId: number, input: { chatId: number; role: "user" | "assistant"; content: string }) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, input.chatId);
  if (!chat) return undefined;
  const [message] = await db.insert(chatMessages).values({ chatId: chat.id, role: input.role, content: input.content }).returning();
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chat.id));
  return message;
}

export async function getWorkspaceComputer(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const [folders, files, chatRows, settings] = await Promise.all([
    listWorkspaceFoldersForUser(ownerId),
    listWorkspaceFilesForUser(ownerId),
    listChatsForUser(ownerId),
    getWorkspaceModelSettingsForUser(ownerId),
  ]);
  return { workspace, folders, files, chats: chatRows, settings };
}

function toSafeTelegramSettings(setting: typeof telegramBotSettings.$inferSelect | undefined) {
  if (!setting) return { configured: false as const, chatId: null, botUsername: null, botDisplayName: null };
  return {
    configured: true as const,
    chatId: setting.chatId,
    botUsername: setting.botUsername,
    botDisplayName: setting.botDisplayName,
  };
}

export async function getTelegramSettingsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const setting = (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).limit(1))[0];
  return toSafeTelegramSettings(setting);
}

export async function saveTelegramSettingsForUser(ownerId: number, input: { botToken: string; chatId?: string | null; botUsername?: string | null; botDisplayName?: string | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await db.insert(telegramBotSettings).values({
    workspaceId: workspace.id,
    encryptedBotToken: encryptPrivateCredential(input.botToken),
    chatId: input.chatId ?? null,
    botUsername: input.botUsername ?? null,
    botDisplayName: input.botDisplayName ?? null,
  }).onConflictDoUpdate({
    target: telegramBotSettings.workspaceId,
    set: {
      encryptedBotToken: encryptPrivateCredential(input.botToken),
      chatId: input.chatId ?? null,
      botUsername: input.botUsername ?? null,
      botDisplayName: input.botDisplayName ?? null,
      updatedAt: new Date(),
    },
  });
  return getTelegramSettingsForUser(ownerId);
}

export async function updateTelegramChatForUser(ownerId: number, chatId: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [updated] = await db.update(telegramBotSettings).set({ chatId, updatedAt: new Date() }).where(eq(telegramBotSettings.workspaceId, workspace.id)).returning();
  return toSafeTelegramSettings(updated);
}

export async function getTelegramCredentialsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const setting = (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).limit(1))[0];
  if (!setting) return undefined;
  return { token: decryptPrivateCredential(setting.encryptedBotToken), chatId: setting.chatId, botUsername: setting.botUsername, botDisplayName: setting.botDisplayName };
}

export async function deleteTelegramSettingsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [deleted] = await db.delete(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).returning({ id: telegramBotSettings.id });
  return Boolean(deleted);
}

export async function getNvidiaInferenceAllowanceForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const allowance = (await db.select().from(nvidiaInferenceAllowances).where(eq(nvidiaInferenceAllowances.workspaceId, workspace.id)).limit(1))[0];
  return {
    usedRequests: Number(allowance?.usedRequests ?? 0),
    updatedAt: allowance?.updatedAt ?? null,
  };
}

/** Atomically claim one workspace request only when its configured allowance remains available. */
export async function claimNvidiaInferenceRequestForUser(ownerId: number, maxRequests: number) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) return undefined;
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const result = await db.execute(sql`
    INSERT INTO "nvidia_inference_allowances" ("workspaceId", "usedRequests", "createdAt", "updatedAt")
    VALUES (${workspace.id}, 1, now(), now())
    ON CONFLICT ("workspaceId") DO UPDATE
    SET "usedRequests" = "nvidia_inference_allowances"."usedRequests" + 1,
        "updatedAt" = now()
    WHERE "nvidia_inference_allowances"."usedRequests" < ${maxRequests}
    RETURNING "usedRequests"
  `) as unknown as { rows?: Array<{ usedRequests: number }> } | Array<{ usedRequests: number }>;
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  const claimed = rows[0];
  return claimed ? { usedRequests: Number(claimed.usedRequests) } : undefined;
}

type AgentVmRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "disabled";

async function getAgentVmRunForUser(ownerId: number, runId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(agentVmRuns).where(and(eq(agentVmRuns.id, runId), eq(agentVmRuns.workspaceId, workspace.id))).limit(1))[0];
}

export function toSafeAgentVmRun(run: typeof agentVmRuns.$inferSelect) {
  return {
    id: run.id,
    provider: run.provider,
    sandboxId: run.sandboxId,
    task: run.task,
    status: run.status,
    resultSummary: run.resultSummary,
    errorMessage: run.errorMessage,
    artifactFileId: run.artifactFileId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function listAgentVmRunsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const runs = await db.select().from(agentVmRuns).where(eq(agentVmRuns.workspaceId, workspace.id)).orderBy(desc(agentVmRuns.createdAt)).limit(20);
  return runs.map(toSafeAgentVmRun);
}

export async function createAgentVmRunForUser(ownerId: number, input: { task: string; provider?: "daytona" }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [created] = await db.insert(agentVmRuns).values({ workspaceId: workspace.id, provider: input.provider ?? "daytona", task: input.task, status: "queued" }).returning();
  if (!created) throw new Error("Nova could not queue the agent VM run.");
  return toSafeAgentVmRun(created);
}

export async function updateAgentVmRunForUser(ownerId: number, runId: number, input: { status?: AgentVmRunStatus; sandboxId?: string | null; resultSummary?: string | null; errorMessage?: string | null; artifactFileId?: number | null; startedAt?: Date | null; completedAt?: Date | null }) {
  const db = await requireDb();
  const run = await getAgentVmRunForUser(ownerId, runId);
  if (!run) return undefined;
  const updateSet: Partial<typeof agentVmRuns.$inferInsert> = { updatedAt: new Date() };
  if (input.status !== undefined) updateSet.status = input.status;
  if (input.sandboxId !== undefined) updateSet.sandboxId = input.sandboxId;
  if (input.resultSummary !== undefined) updateSet.resultSummary = input.resultSummary;
  if (input.errorMessage !== undefined) updateSet.errorMessage = input.errorMessage;
  if (input.artifactFileId !== undefined) updateSet.artifactFileId = input.artifactFileId;
  if (input.startedAt !== undefined) updateSet.startedAt = input.startedAt;
  if (input.completedAt !== undefined) updateSet.completedAt = input.completedAt;
  const [updated] = await db.update(agentVmRuns).set(updateSet).where(eq(agentVmRuns.id, run.id)).returning();
  return updated ? toSafeAgentVmRun(updated) : undefined;
}

export async function getActiveAgentVmRunForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const active = (await db.select().from(agentVmRuns).where(and(eq(agentVmRuns.workspaceId, workspace.id), inArray(agentVmRuns.status, ["queued", "running"]))).limit(1))[0];
  return active ? toSafeAgentVmRun(active) : undefined;
}

export async function countAgentVmRunsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [result] = await db.select({ total: count() }).from(agentVmRuns).where(and(eq(agentVmRuns.workspaceId, workspace.id), eq(agentVmRuns.provider, "daytona")));
  return Number(result?.total ?? 0);
}

type AutomationKind = "workspace_digest";
type AutomationRunStatus = "running" | "succeeded" | "failed" | "skipped";

function toSafeAutomation(automation: typeof automations.$inferSelect) {
  return {
    id: automation.id,
    kind: automation.kind,
    enabled: automation.enabled,
    scheduleActive: Boolean(automation.scheduleCronTaskUid),
    lastRunAt: automation.lastRunAt,
    lastError: automation.lastError,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}

function toSafeAutomationRun(run: typeof automationRuns.$inferSelect) {
  return {
    id: run.id,
    automationId: run.automationId,
    runKey: run.runKey,
    status: run.status,
    summary: run.summary,
    errorMessage: run.errorMessage,
    artifactFileId: run.artifactFileId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function getOrCreateAutomationForUser(ownerId: number, kind: AutomationKind = "workspace_digest") {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const ownership = and(eq(automations.ownerId, ownerId), eq(automations.workspaceId, workspace.id), eq(automations.kind, kind));
  const existing = (await db.select().from(automations).where(ownership).limit(1))[0];
  if (existing) return toSafeAutomation(existing);
  await db.insert(automations).values({ ownerId, workspaceId: workspace.id, kind, enabled: false }).onConflictDoNothing();
  const created = (await db.select().from(automations).where(ownership).limit(1))[0];
  if (!created) throw new Error("Nova could not create the workspace automation.");
  return toSafeAutomation(created);
}

export async function listAutomationRecordsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await getOrCreateAutomationForUser(ownerId);
  return db.select().from(automations).where(and(
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).orderBy(asc(automations.createdAt));
}

export async function listAutomationsForUser(ownerId: number) {
  return (await listAutomationRecordsForUser(ownerId)).map(toSafeAutomation);
}

export async function getAutomationRecordForUser(ownerId: number, automationId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(automations).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).limit(1))[0];
}

export async function updateAutomationForUser(ownerId: number, automationId: number, input: { enabled: boolean }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [updated] = await db.update(automations).set({ enabled: input.enabled, updatedAt: new Date() }).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).returning();
  return updated ? toSafeAutomation(updated) : undefined;
}

/** Stores the opaque task ID only after the current account has been authorized for the automation. */
export async function setAutomationScheduleTaskForUser(ownerId: number, automationId: number, scheduleCronTaskUid: string | null) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [updated] = await db.update(automations).set({ scheduleCronTaskUid, updatedAt: new Date() }).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).returning();
  return updated ? toSafeAutomation(updated) : undefined;
}

/** Resolves only the account-owned automation authenticated by the scheduler's opaque task ID. */
export async function getAutomationForScheduleTask(scheduleCronTaskUid: string) {
  const db = await requireDb();
  return (await db.select().from(automations).where(eq(automations.scheduleCronTaskUid, scheduleCronTaskUid)).limit(1))[0];
}

export async function listAutomationRunsForUser(ownerId: number, automationId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const automation = (await db.select().from(automations).where(and(
    eq(automations.id, automationId),
    eq(automations.ownerId, ownerId),
    eq(automations.workspaceId, workspace.id),
  )).limit(1))[0];
  if (!automation) return [];
  const runs = await db.select().from(automationRuns).where(and(
    eq(automationRuns.automationId, automation.id),
    eq(automationRuns.ownerId, ownerId),
    eq(automationRuns.workspaceId, workspace.id),
  )).orderBy(desc(automationRuns.createdAt)).limit(12);
  return runs.map(toSafeAutomationRun);
}

export async function claimAutomationRun(input: { automationId: number; ownerId: number; workspaceId: number; runKey: string }) {
  const db = await requireDb();
  const [created] = await db.insert(automationRuns).values({
    automationId: input.automationId,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    runKey: input.runKey,
    status: "running",
  }).onConflictDoUpdate({
    target: [automationRuns.automationId, automationRuns.runKey],
    set: { status: "running", summary: null, errorMessage: null, completedAt: null, updatedAt: new Date() },
    setWhere: and(
      eq(automationRuns.ownerId, input.ownerId),
      eq(automationRuns.workspaceId, input.workspaceId),
      eq(automationRuns.status, "failed"),
    ),
  }).returning();
  return created ? toSafeAutomationRun(created) : undefined;
}

export async function updateAutomationRun(input: { automationId: number; ownerId: number; workspaceId: number; runId: number; status: AutomationRunStatus; summary?: string | null; errorMessage?: string | null; artifactFileId?: number | null; completedAt?: Date | null }) {
  const db = await requireDb();
  const [updated] = await db.update(automationRuns).set({
    status: input.status,
    summary: input.summary,
    errorMessage: input.errorMessage,
    artifactFileId: input.artifactFileId,
    completedAt: input.completedAt,
    updatedAt: new Date(),
  }).where(and(
    eq(automationRuns.id, input.runId),
    eq(automationRuns.automationId, input.automationId),
    eq(automationRuns.ownerId, input.ownerId),
    eq(automationRuns.workspaceId, input.workspaceId),
  )).returning();
  return updated ? toSafeAutomationRun(updated) : undefined;
}

export async function updateAutomationScheduleState(input: { automationId: number; ownerId: number; workspaceId: number; lastRunAt?: Date | null; lastError?: string | null }) {
  const db = await requireDb();
  const [updated] = await db.update(automations).set({
    lastRunAt: input.lastRunAt,
    lastError: input.lastError,
    updatedAt: new Date(),
  }).where(and(
    eq(automations.id, input.automationId),
    eq(automations.ownerId, input.ownerId),
    eq(automations.workspaceId, input.workspaceId),
  )).returning();
  return updated ? toSafeAutomation(updated) : undefined;
}

import { createHmac } from "crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
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
  mistralInferenceAllowances,
  agentVmRuns,
  agentStopRequests,
  telegramUpdateLog,
  automations,
  automationRuns,
  siteDeployments,
  agentRuns,
} from "../drizzle/schema";
import { decryptPrivateCredential, encryptModelApiKey, encryptPrivateCredential } from "./modelSecrets";
import { getTelegramWebhookInfo } from "./telegram";
import { ENV } from "./_core/env";
import { getE2BClient, initWorkspacePersistentVm } from "./e2b";
import { wouldCreateWorkspaceFolderCycle } from "./workspaceFolderTree";

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
    loginMethod: user.loginMethod ?? "neon_email_otp",
    role: user.role ?? "user",
    lastSignedIn: user.lastSignedIn ?? new Date(),
  }).onConflictDoUpdate({
    target: users.openId,
    set: {
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? "neon_email_otp",
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
  return !!deleted;
}

/** True when an admin has banned this account. Banned accounts cannot sign in
 * or use the Telegram bot; the ban is a first-party Nova state, independent of
 * the Neon Auth identity. */
export async function isUserBanned(userId: number): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ bannedAt: users.bannedAt }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(row?.bannedAt);
}

/** Identity details the workspace agent greets the user by. */
export async function getUserIdentityForUser(userId: number): Promise<{ username: string | null; name: string | null; email: string | null }> {
  const db = await requireDb();
  const [row] = await db.select({ username: users.username, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? { username: null, name: null, email: null };
}

/** True when another account already claims this username (case-insensitive). */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  return Boolean(row);
}

/** Claims or re-claims the username for an account. Returns the updated row. */
export async function setUsernameForUser(userId: number, username: string) {
  const db = await requireDb();
  const [updated] = await db.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
  return updated;
}


/**
 * Ensures that a user's durable E2B sandbox exists and that Nova retains
 * its sandbox identifier. This is deliberately idempotent: it runs for a new
 * workspace and repairs an older workspace whose computer was never stored.
 */
async function ensureWorkspacePersistentVm<T extends typeof workspaces.$inferSelect>(workspace: T, ownerId: number): Promise<T> {
  const sandboxId = await initWorkspacePersistentVm(workspace.id, ownerId, workspace.persistentSandboxId);
  if (!sandboxId || workspace.persistentSandboxId === sandboxId) return workspace;

  const db = await requireDb();
  const [claimed] = await db
    .update(workspaces)
    .set({ persistentSandboxId: sandboxId, updatedAt: new Date() })
    .where(and(eq(workspaces.id, workspace.id), isNull(workspaces.persistentSandboxId)))
    .returning({ persistentSandboxId: workspaces.persistentSandboxId });

  if (claimed) {
    return { ...workspace, persistentSandboxId: sandboxId };
  }
  // Another process won the race - re-read the winner's sandbox ID
  const db2 = await requireDb();
  const [winner] = await db2
    .select({ persistentSandboxId: workspaces.persistentSandboxId })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id))
    .limit(1);
  return { ...workspace, persistentSandboxId: winner?.persistentSandboxId ?? sandboxId };
}

export async function getWorkspacePersistentSandbox(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  if (!workspace.persistentSandboxId) return null;
  const client = getE2BClient();
  if (!client) return null;
  try {
    return await client.connect(workspace.persistentSandboxId);
  } catch {
    return null;
  }
}

/**
 * Backfills the durable container for an existing account without replacing
 * its workspace or any already-recorded sandbox identifier.
 */
export async function ensureUserWorkspaceProvisioned(ownerId: number): Promise<void> {
  const db = await requireDb();
  const [workspace] = await db
    .select({ id: workspaces.id, persistentSandboxId: workspaces.persistentSandboxId })
    .from(workspaces)
    .where(eq(workspaces.ownerId, ownerId))
    .limit(1);

  if (workspace?.persistentSandboxId) return;

  await getOrCreateWorkspace(ownerId);
}

export async function updateWorkspacePersistentSandbox(workspaceId: number, sandboxId: string) {
  const db = await requireDb();
  await db.update(workspaces).set({ persistentSandboxId: sandboxId }).where(eq(workspaces.id, workspaceId));
}

export async function getOrCreateWorkspace(ownerId: number) {
  const db = await requireDb();
  const existing = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  let workspace = existing[0];
  if (!workspace) {
    await db.insert(workspaces).values({ ownerId, name: "My Nova Space" }).onConflictDoNothing();
    const created = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
    workspace = created[0];
  }
  if (!workspace) throw new Error("Nova could not create a workspace.");

  // The durable sandbox is already recorded: return the fresh row without
  // reconnecting or re-provisioning. VM/automation flows that need a live
  // sandbox connect explicitly via ensurePersistentSandbox/initWorkspacePersistentVm.
  if (workspace.persistentSandboxId) return workspace;

  try {
    return await ensureWorkspacePersistentVm(workspace, ownerId);
  } catch {
    // Workspace access remains available if the provider is temporarily unavailable.
    return workspace;
  }
}

type ActiveProvider = "anthropic" | "openai" | "gemini" | "custom" | "mistral";
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

/** The user's saved communication-style preference, injected into every agent run. */
export async function getCommunicationStyleForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [row] = await db.select({ communicationStyle: workspaceSettings.communicationStyle }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspace.id)).limit(1);
  return row?.communicationStyle ?? null;
}

/** Persists the user's communication-style preference (set by the agent via its tool). */
export async function setCommunicationStyleForUser(ownerId: number, style: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const trimmed = style.trim().slice(0, 500);
  await db.update(workspaceSettings).set({ communicationStyle: trimmed, updatedAt: new Date() }).where(eq(workspaceSettings.workspaceId, workspace.id));
  return trimmed;
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
  return !!deleted;
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
  return !!deleted;
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

export async function getChatForUser(ownerId: number, chatId: number) {
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
    const workspace = await getOrCreateWorkspace(ownerId);
    const folders = await db
      .select({ id: workspaceFolders.id, parentId: workspaceFolders.parentId })
      .from(workspaceFolders)
      .where(eq(workspaceFolders.workspaceId, workspace.id));
    if (wouldCreateWorkspaceFolderCycle(folders, folder.id, parent.id))
      return undefined;
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

export async function updateChatForUser(ownerId: number, chatId: number, title: string) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(chats).set({ title, updatedAt: new Date() }).where(eq(chats.id, chat.id)).returning();
  return updated;
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

/** Read the stored sandbox identifier without provisioning or resuming a sandbox. */
export async function getStoredWorkspaceSandboxId(ownerId: number) {
  const db = await requireDb();
  const [workspace] = await db.select({ id: workspaces.id, persistentSandboxId: workspaces.persistentSandboxId }).from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  return workspace ?? null;
}

type TelegramWebhookStatus = { linked: boolean };

async function resolveTelegramWebhookStatus(setting: typeof telegramBotSettings.$inferSelect): Promise<TelegramWebhookStatus | null> {
  try {
    const token = decryptPrivateCredential(setting.encryptedBotToken);
    const info = await getTelegramWebhookInfo(token);
    // Never expose the webhook URL: it embeds the bot token.
    return { linked: info.linked };
  } catch {
    return { linked: false };
  }
}

/** Deterministic per-workspace code that authorizes a Telegram chat link through the shared bot. */
export function telegramLinkCodeForUser(ownerId: number) {
  return createHmac("sha256", ENV.modelCredentialSecret).update(`nova-telegram-link:${ownerId}`).digest("hex").slice(0, 12);
}

/** Resolves the workspace owner whose link code matches, for secure webhook-time chat linking. */
export async function findWorkspaceOwnerByTelegramLinkCode(linkCode: string) {
  const db = await requireDb();
  const rows = await db.select({ workspaceId: telegramBotSettings.workspaceId }).from(telegramBotSettings);
  for (const row of rows) {
    const ws = (await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0];
    if (ws && telegramLinkCodeForUser(ws.ownerId).toLowerCase() === linkCode.toLowerCase()) return ws.ownerId;
  }
  return null;
}

function toSafeTelegramSettings(setting: typeof telegramBotSettings.$inferSelect | undefined, webhook: TelegramWebhookStatus | null, ownerId: number) {
  const linkCode = telegramLinkCodeForUser(ownerId);
  if (!setting) return { configured: false as const, chatId: null, botUsername: null, botDisplayName: null, webhook: null, linkCode };
  return {
    configured: true as const,
    chatId: setting.chatId,
    botUsername: setting.botUsername,
    botDisplayName: setting.botDisplayName,
    webhook,
    linkCode,
  };
}

/**
 * Returns the workspace's Telegram bot row, materializing a record for the
 * server-wide default bot when the owner has not configured an explicit token
 * yet. Returns undefined only when no default bot is set and nothing is saved.
 */
async function getOrCreateTelegramSetting(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const existing = (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).limit(1))[0];
  if (existing) return existing;
  if (!ENV.defaultTelegramBotToken) return undefined;
  const [inserted] = await db.insert(telegramBotSettings).values({
    workspaceId: workspace.id,
    encryptedBotToken: encryptPrivateCredential(ENV.defaultTelegramBotToken),
    chatId: null,
    botUsername: null,
    botDisplayName: null,
  }).onConflictDoNothing({ target: telegramBotSettings.workspaceId }).returning();
  if (inserted) return inserted;
  // A concurrent first-insert wins and returns no row to the loser: reread the winner's.
  return (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).limit(1))[0] ?? existing;
}

export async function getTelegramSettingsForUser(ownerId: number) {
  const setting = await getOrCreateTelegramSetting(ownerId);
  const webhook = setting ? await resolveTelegramWebhookStatus(setting) : null;
  return toSafeTelegramSettings(setting, webhook, ownerId);
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
  const setting = await getOrCreateTelegramSetting(ownerId);
  if (!setting) return toSafeTelegramSettings(undefined, null, ownerId);
  const db = await requireDb();
  const [updated] = await db.update(telegramBotSettings).set({ chatId, updatedAt: new Date() }).where(eq(telegramBotSettings.workspaceId, setting.workspaceId)).returning();
  const webhook = updated ? await resolveTelegramWebhookStatus(updated) : null;
  return toSafeTelegramSettings(updated, webhook, ownerId);
}

export async function getTelegramCredentialsForUser(ownerId: number) {
  const setting = await getOrCreateTelegramSetting(ownerId);
  if (!setting) return undefined;
  return { token: decryptPrivateCredential(setting.encryptedBotToken), chatId: setting.chatId, botUsername: setting.botUsername, botDisplayName: setting.botDisplayName };
}

export async function deleteTelegramSettingsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [deleted] = await db.delete(telegramBotSettings).where(eq(telegramBotSettings.workspaceId, workspace.id)).returning({ id: telegramBotSettings.id });
  return !!deleted;
}

export async function findWorkspaceOwnerByTelegramToken(token: string, chatId?: string) {
  const db = await requireDb();
  // Shared (default) bot: isolate by Telegram chatId - each Telegram user is
  // bound to exactly one workspace via telegramBotSettings.chatId. This prevents
  // cross-tenant message leakage when many users share the same bot.
  if (ENV.defaultTelegramBotToken && token === ENV.defaultTelegramBotToken) {
    if (chatId) {
      const linked = (await db.select().from(telegramBotSettings).where(eq(telegramBotSettings.chatId, chatId)).limit(1))[0];
      if (linked) {
        const ws = (await db.select().from(workspaces).where(eq(workspaces.id, linked.workspaceId)).limit(1))[0];
        if (ws) return ws.ownerId;
      }
    }
    // Unlinked chat: do not attribute to oldest workspace - caller must handle null (ask to link).
    return null;
  }
  const rows = await db.select().from(telegramBotSettings);
  for (const row of rows) {
    try {
      const decrypted = decryptPrivateCredential(row.encryptedBotToken);
      if (decrypted === token) {
        const workspace = (await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1))[0];
        return workspace?.ownerId ?? null;
      }
    } catch {
      // skip corrupted encrypted value
    }
  }
  return null;
}

export async function getMistralInferenceAllowanceForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const allowance = (await db.select().from(mistralInferenceAllowances).where(eq(mistralInferenceAllowances.workspaceId, workspace.id)).limit(1))[0];
  return {
    usedRequests: Number(allowance?.usedRequests ?? 0),
    updatedAt: allowance?.updatedAt ?? null,
  };
}

/** Atomically claim one workspace request only when its configured allowance remains available. */
export async function claimMistralInferenceRequestForUser(ownerId: number, maxRequests: number | null) {
  if (maxRequests !== null && (!Number.isInteger(maxRequests) || maxRequests < 1)) return undefined;
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const result = await db.execute(sql`
    INSERT INTO "mistral_inference_allowances" ("workspaceId", "usedRequests", "createdAt", "updatedAt")
    VALUES (${workspace.id}, 1, now(), now())
    ON CONFLICT ("workspaceId") DO UPDATE
    SET "usedRequests" = "mistral_inference_allowances"."usedRequests" + 1,
        "updatedAt" = now()
    ${maxRequests === null ? sql`` : sql`WHERE "mistral_inference_allowances"."usedRequests" < ${maxRequests}`}
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

export async function createAgentVmRunForUser(ownerId: number, input: { task: string; provider?: "e2b" }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [created] = await db.insert(agentVmRuns).values({ workspaceId: workspace.id, provider: input.provider ?? "e2b", task: input.task, status: "queued" }).returning();
  if (!created) throw new Error("Nova could not queue the agent VM run.");
  return toSafeAgentVmRun(created);
}

/** Current database server time - used so stop requests and run starts are compared on one clock. */
export async function getDatabaseTime(): Promise<Date> {
  const db = await requireDb();
  const result = (await db.execute(sql`select now() as now`)) as unknown as { rows?: Array<{ now: string | Date }> } | Array<{ now: string | Date }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const value = rows[0]?.now;
  if (!value) return new Date();
  return value instanceof Date ? value : new Date(value);
}

/**
 * Atomically claims a Telegram webhook update id. Returns true when this call
 * is the first to see the update, false when Telegram is redelivering an
 * update Nova already handled (the webhook holds the HTTP connection open for
 * the whole agent run, so Telegram re-sends updates it saw time out - without
 * this claim every redelivery would re-run the agent and duplicate replies).
 * Old rows are pruned opportunistically; a database error fails open so the
 * bot keeps working even if the log table is unavailable.
 */
export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  const db = await requireDb();
  try {
    await db.execute(sql`DELETE FROM "telegram_update_log" WHERE "createdAt" < now() - interval '7 days'`);
  } catch {}
  const claimed = await db
    .insert(telegramUpdateLog)
    .values({ updateId })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdateLog.updateId });
  return claimed.length > 0;
}

/** Records a fresh stop request for the workspace, replacing any older one. */
export async function requestAgentStopForUser(ownerId: number) {
  const db = await requireDb();
  await db.delete(agentStopRequests).where(eq(agentStopRequests.ownerId, ownerId));
  const [created] = await db.insert(agentStopRequests).values({ ownerId }).returning();
  return created;
}

/** True when a stop request was recorded after `startedAt` for this workspace owner. */
/** Total segments one user message may consume (the initial run plus continuations), bounding chained self-invocations. */
/**
 * The hard cap on chained segments for one user message. Each segment gets its
 * own serverless invocation with a fresh ~285s budget, so this is the total
 * chained runtime one message may consume: 60 segments is just under 4.75
 * hours of continuous agent work. The cap exists only as runaway protection
 * (a model stuck in a loop must not bill the gateway indefinitely); when it
 * is finally reached the closing status tells the user to send "continue".
 */
export const MAX_RUN_SEGMENTS = 60;

/** Moves a just-delivered run to awaiting_continue so a continuation endpoint can claim its next segment. */
export async function holdAgentRunForContinue(ownerId: number, runId: number) {
  const db = await requireDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return undefined;
  const chat = await getChatForUser(ownerId, run.chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(agentRuns).set({ status: "awaiting_continue", updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running"))).returning();
  return updated;
}

export interface AgentRunContinuationClaim {
  runId: number;
  segment: number;
  chatId: number;
  ownerId: number;
  token: string;
  telegramChatId: string;
}

/**
 * Atomically claims the next segment of a segmented run: only an
 * awaiting_continue row at the expected segment flips back to running with
 * segment + 1, so concurrent or redelivered continuation requests can never
 * double-run a segment. Rows already at the segment limit cannot be claimed.
 */
export async function claimAgentRunContinuation(runId: number, expectedSegment: number) {
  const db = await requireDb();
  const [claimed] = await db.update(agentRuns).set({ status: "running", segment: sql`${agentRuns.segment} + 1`, updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "awaiting_continue"), eq(agentRuns.segment, expectedSegment), lt(agentRuns.segment, MAX_RUN_SEGMENTS - 1)))
    .returning();
  if (!claimed) return undefined;
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, claimed.workspaceId));
  if (!workspace) return undefined;
  const credentials = await getTelegramCredentialsForUser(workspace.ownerId).catch(() => undefined);
  if (!credentials?.token || !claimed.notifyChatId) {
    // The continuation could never deliver its reply: close the run rather than leave it stuck awaiting_continue.
    await db.update(agentRuns).set({ status: "failed", errorMessage: "continuation could not resolve its Telegram delivery target", completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, claimed.id));
    return undefined;
  }
  return { runId: claimed.id, segment: claimed.segment, chatId: claimed.chatId, ownerId: workspace.ownerId, token: credentials.token, telegramChatId: claimed.notifyChatId } satisfies AgentRunContinuationClaim;
}

/** Starts a segmented agent run ledger row: one row per user message that begins agent work. */
export async function startAgentRunForUser(ownerId: number, input: { chatId: number; channel?: string; notifyChatId?: string }) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, input.chatId);
  if (!chat) return undefined;
  const [run] = await db.insert(agentRuns).values({
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    channel: input.channel ?? "telegram",
    notifyChatId: input.notifyChatId ?? null,
  }).returning();
  return run;
}

/** Closes a run ledger row (completed/stopped/failed); only live rows can be closed. */
export async function finishAgentRunForUser(ownerId: number, runId: number, status: "completed" | "stopped" | "failed", errorMessage?: string) {
  const db = await requireDb();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return undefined;
  const chat = await getChatForUser(ownerId, run.chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(agentRuns).set({
    status,
    errorMessage: errorMessage ?? null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.id, run.id), inArray(agentRuns.status, ["running", "awaiting_continue"]))).returning();
  return updated;
}

export async function hasAgentStopAfter(ownerId: number, startedAt: Date) {
  const db = await requireDb();
  const rows = await db
    .select({ id: agentStopRequests.id })
    .from(agentStopRequests)
    .where(and(eq(agentStopRequests.ownerId, ownerId), gt(agentStopRequests.createdAt, startedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Cancels the owner's queued/running agent VM runs; returns how many were cancelled. */
export async function cancelActiveAgentVmRunsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const cancelled = await db
    .update(agentVmRuns)
    .set({ status: "cancelled", errorMessage: "Cancelled by /stop.", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentVmRuns.workspaceId, workspace.id), inArray(agentVmRuns.status, ["queued", "running"])))
    .returning({ id: agentVmRuns.id });
  return cancelled.length;
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
  const [result] = await db.select({ total: count() }).from(agentVmRuns).where(eq(agentVmRuns.workspaceId, workspace.id));
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

export async function renameChatIfDefaultForUser(ownerId: number, chatId: number, title: string, defaultTitles: string[]) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return undefined;
  const [updated] = await db.update(chats)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chats.id, chat.id), inArray(chats.title, defaultTitles)))
    .returning();
  return updated;
}

export async function deleteChatForUser(ownerId: number, chatId: number) {
  const db = await requireDb();
  const chat = await getChatForUser(ownerId, chatId);
  if (!chat) return false;
  await db.delete(chats).where(eq(chats.id, chat.id));
  return true;
}


export type SiteDeploymentRow = typeof siteDeployments.$inferSelect;

/** Latest website deployment for the workspace (any status), for site reuse and the live URL. */
export async function getLatestSiteDeploymentForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [latest] = await db.select().from(siteDeployments)
    .where(eq(siteDeployments.workspaceId, workspace.id))
    .orderBy(desc(siteDeployments.createdAt))
    .limit(1);
  return latest ?? null;
}

/** Recent website deployments, newest first. */
export async function listSiteDeploymentsForUser(ownerId: number, limit = 10) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(siteDeployments)
    .where(eq(siteDeployments.workspaceId, workspace.id))
    .orderBy(desc(siteDeployments.createdAt))
    .limit(limit);
}

/** Every distinct Netlify site the workspace has ever deployed (any status), for deletion sweeps. */
export async function listSiteDeploymentSiteIdsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.selectDistinct({ siteId: siteDeployments.siteId })
    .from(siteDeployments)
    .where(eq(siteDeployments.workspaceId, workspace.id));
  return rows.map(row => row.siteId);
}

/** Marks every deployment record of one Netlify site as deleted. Returns how many rows changed. */
export async function markSiteDeploymentsDeletedForUser(ownerId: number, siteId: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.update(siteDeployments)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(siteDeployments.siteId, siteId), eq(siteDeployments.workspaceId, workspace.id)))
    .returning({ id: siteDeployments.id });
  return rows.length;
}

/** One entry per Netlify site the workspace has ever deployed - the deployment
 * registry the agent targets sites by. Every run row of the same site carries
 * the same deploymentKey; the newest row decides the entry's status and URL. */
export type SiteDeploymentRegistryEntry = {
  key: string;
  siteId: string;
  siteName: string | null;
  siteUrl: string;
  description: string | null;
  status: "deploying" | "live" | "failed" | "deleted";
  lastDeployedAt: Date;
};

export async function listSiteDeploymentRegistryForUser(ownerId: number): Promise<SiteDeploymentRegistryEntry[]> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  // Newest first: the first row seen per key is that deployment's latest run.
  const rows = await db.select().from(siteDeployments)
    .where(eq(siteDeployments.workspaceId, workspace.id))
    .orderBy(desc(siteDeployments.createdAt))
    .limit(500);
  const byKey = new Map<string, SiteDeploymentRegistryEntry>();
  for (const row of rows) {
    // Null keys only exist for rows a backfill could not reach; group them by site.
    const key = row.deploymentKey ?? row.siteId;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      siteId: row.siteId,
      siteName: row.siteName,
      siteUrl: row.siteUrl,
      description: row.description,
      status: row.status,
      lastDeployedAt: row.createdAt,
    });
  }
  return Array.from(byKey.values());
}

/** The registry entry for one deployment key, or null when the key is unknown. */
export async function getSiteDeploymentByKeyForUser(ownerId: number, key: string): Promise<SiteDeploymentRegistryEntry | null> {
  const registry = await listSiteDeploymentRegistryForUser(ownerId);
  return registry.find(entry => entry.key.toLowerCase() === key.trim().toLowerCase()) ?? null;
}

/** The next free deployment key for this workspace, e.g. 'd-03' after d-02. */
export async function nextSiteDeploymentKeyForUser(ownerId: number): Promise<string> {
  const registry = await listSiteDeploymentRegistryForUser(ownerId);
  let max = 0;
  for (const entry of registry) {
    const match = /^d-(\d+)$/.exec(entry.key);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `d-${String(max + 1).padStart(2, "0")}`;
}

/** Rewrites a deployment's short description on every run row that carries the key. */
export async function updateSiteDeploymentDescriptionForUser(ownerId: number, key: string, description: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.update(siteDeployments)
    .set({ description: description.slice(0, 240), updatedAt: new Date() })
    .where(and(eq(siteDeployments.deploymentKey, key), eq(siteDeployments.workspaceId, workspace.id)))
    .returning({ id: siteDeployments.id });
  return rows.length;
}

/** Records the start of a website deployment. */
export async function recordSiteDeployment(
  ownerId: number,
  input: { siteId: string; siteName: string | null; siteUrl: string; fileCount: number; status: "deploying" | "live" | "failed"; deploymentKey?: string; description?: string | null; error?: string }
) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [row] = await db.insert(siteDeployments).values({
    workspaceId: workspace.id,
    siteId: input.siteId,
    siteName: input.siteName,
    siteUrl: input.siteUrl,
    deploymentKey: input.deploymentKey,
    description: input.description ? input.description.slice(0, 240) : null,
    fileCount: input.fileCount,
    status: input.status,
    ...(input.error ? { error: input.error.slice(0, 1200) } : {}),
  }).returning();
  return row;
}

/** Marks a website deployment live or failed once Netlify finishes processing. */
export async function updateSiteDeploymentStatusForUser(
  ownerId: number,
  deploymentId: number,
  status: "live" | "failed",
  error?: string
) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [row] = await db.update(siteDeployments)
    .set({ status, ...(error ? { error: error.slice(0, 1200) } : {}), updatedAt: new Date() })
    .where(and(eq(siteDeployments.id, deploymentId), eq(siteDeployments.workspaceId, workspace.id)))
    .returning();
  return row ?? null;
}

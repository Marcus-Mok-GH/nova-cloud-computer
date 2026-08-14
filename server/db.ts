import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { customModels, InsertUser, projects, tasks, users, workspaces, workspaceSettings } from "../drizzle/schema";
import { encryptModelApiKey } from "./modelSecrets";

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

import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, projects, tasks, users, workspaces } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The Nova database is unavailable.");
  return db;
}

export async function getOrCreateWorkspace(ownerId: number) {
  const db = await requireDb();
  const existing = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  if (existing[0]) return existing[0];

  await db.insert(workspaces).values({ ownerId, name: "My Nova Space" });
  const created = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  if (!created[0]) throw new Error("Nova could not create a workspace.");
  return created[0];
}

export async function listProjectsForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(projects).where(eq(projects.workspaceId, workspace.id)).orderBy(asc(projects.createdAt));
}

export async function createProjectForUser(ownerId: number, input: { name: string; description?: string | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await db.insert(projects).values({
    workspaceId: workspace.id,
    name: input.name,
    description: input.description ?? null,
  });
  const created = await db.select().from(projects).where(and(eq(projects.workspaceId, workspace.id), eq(projects.name, input.name))).orderBy(asc(projects.id));
  return created.at(-1);
}

export async function getProjectForUser(ownerId: number, projectId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const result = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id))).limit(1);
  return result[0];
}

export async function deleteProjectForUser(ownerId: number, projectId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const project = await getProjectForUser(ownerId, projectId);
  if (!project || project.workspaceId !== workspace.id) return false;
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id)));
  return true;
}

export async function updateProjectForUser(ownerId: number, projectId: number, input: { name?: string; description?: string | null; status?: "active" | "archived" }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const project = await getProjectForUser(ownerId, projectId);
  if (!project || project.workspaceId !== workspace.id) return undefined;

  const updateSet: Partial<typeof projects.$inferInsert> = {};
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.description !== undefined) updateSet.description = input.description;
  if (input.status !== undefined) updateSet.status = input.status;
  if (Object.keys(updateSet).length === 0) return project;

  await db.update(projects).set(updateSet).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id)));
  const updated = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspace.id))).limit(1);
  return updated[0];
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

  await db.insert(tasks).values({
    workspaceId: workspace.id,
    projectId: project.id,
    title: input.title,
    notes: input.notes ?? null,
    dueAt: input.dueAt ?? null,
  });
  const created = await db.select().from(tasks).where(and(eq(tasks.workspaceId, workspace.id), eq(tasks.projectId, project.id), eq(tasks.title, input.title))).orderBy(asc(tasks.id));
  return created.at(-1);
}

export async function updateTaskStatusForUser(ownerId: number, taskId: number, status: "todo" | "in_progress" | "done") {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const ownedTask = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspace.id))).limit(1);
  if (!ownedTask[0]) return undefined;

  await db.update(tasks).set({ status }).where(eq(tasks.id, taskId));
  const updated = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return updated[0];
}

export async function deleteTaskForUser(ownerId: number, taskId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const ownedTask = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspace.id))).limit(1);
  if (!ownedTask[0]) return false;
  await db.delete(tasks).where(eq(tasks.id, taskId));
  return true;
}

export async function getWorkspaceDashboard(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const [projectRows, taskRows] = await Promise.all([listProjectsForUser(ownerId), listTasksForUser(ownerId)]);
  return { workspace, projects: projectRows, tasks: taskRows };
}

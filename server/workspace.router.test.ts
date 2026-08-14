import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

type ProjectRecord = { id: number; workspaceId: number; name: string; description: string | null; status: "active" | "archived" };
type TaskRecord = { id: number; workspaceId: number; projectId: number; title: string; notes: string | null; status: "todo" | "in_progress" | "done" };

const projects = new Map<number, ProjectRecord>();
const tasks = new Map<number, TaskRecord>();
let nextProjectId = 100;
let nextTaskId = 700;

const createProjectSpy = vi.fn(async (ownerId: number, input: { name: string; description?: string | null }) => {
  const project = { id: nextProjectId++, workspaceId: ownerId, name: input.name, description: input.description ?? null, status: "active" as const };
  projects.set(project.id, project);
  return project;
});
const listProjectsSpy = vi.fn(async (ownerId: number) => [...projects.values()].filter(project => project.workspaceId === ownerId));
const getProjectSpy = vi.fn(async (ownerId: number, projectId: number) => projects.get(projectId)?.workspaceId === ownerId ? projects.get(projectId) : undefined);
const updateProjectSpy = vi.fn(async (ownerId: number, projectId: number, input: Partial<ProjectRecord>) => {
  const project = await getProjectSpy(ownerId, projectId);
  if (!project) return undefined;
  const updated = { ...project, ...input };
  projects.set(projectId, updated);
  return updated;
});
const deleteProjectSpy = vi.fn(async (ownerId: number, projectId: number) => {
  const project = await getProjectSpy(ownerId, projectId);
  if (!project) return false;
  projects.delete(projectId);
  for (const task of tasks.values()) if (task.projectId === projectId) tasks.delete(task.id);
  return true;
});
const createTaskSpy = vi.fn(async (ownerId: number, input: { projectId: number; title: string; notes?: string | null }) => {
  if (!await getProjectSpy(ownerId, input.projectId)) return undefined;
  const task = { id: nextTaskId++, workspaceId: ownerId, projectId: input.projectId, title: input.title, notes: input.notes ?? null, status: "todo" as const };
  tasks.set(task.id, task);
  return task;
});
const listTasksSpy = vi.fn(async (ownerId: number) => [...tasks.values()].filter(task => task.workspaceId === ownerId));
const updateTaskSpy = vi.fn(async (ownerId: number, taskId: number, status: TaskRecord["status"]) => {
  const task = tasks.get(taskId);
  if (!task || task.workspaceId !== ownerId) return undefined;
  const updated = { ...task, status };
  tasks.set(taskId, updated);
  return updated;
});
const deleteTaskSpy = vi.fn(async (ownerId: number, taskId: number) => {
  const task = tasks.get(taskId);
  if (!task || task.workspaceId !== ownerId) return false;
  tasks.delete(taskId);
  return true;
});

vi.mock("./db", () => ({
  createProjectForUser: createProjectSpy,
  createTaskForUser: createTaskSpy,
  deleteProjectForUser: deleteProjectSpy,
  deleteTaskForUser: deleteTaskSpy,
  getOrCreateWorkspace: vi.fn(async (ownerId: number) => ({ id: ownerId, ownerId, name: "Space" })),
  getProjectForUser: getProjectSpy,
  getWorkspaceDashboard: vi.fn(async (ownerId: number) => ({ workspace: { id: ownerId, ownerId, name: "Space" }, projects: await listProjectsSpy(ownerId), tasks: await listTasksSpy(ownerId) })),
  listProjectsForUser: listProjectsSpy,
  listTasksForUser: listTasksSpy,
  updateProjectForUser: updateProjectSpy,
  updateTaskStatusForUser: updateTaskSpy,
}));

const { appRouter } = await import("./routers");

function contextFor(id: number): TrpcContext {
  return { user: { id, openId: `user-${id}`, name: `User ${id}`, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("Nova workspace authenticated API", () => {
  beforeEach(() => { projects.clear(); tasks.clear(); nextProjectId = 100; nextTaskId = 700; vi.clearAllMocks(); });

  it("creates, reads, updates, and deletes a project through the authenticated router", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    const project = await caller.projects.create({ name: "Launch a quiet orbit", description: "A real private project." });
    expect(await caller.projects.get({ id: project.id })).toMatchObject({ id: project.id, name: "Launch a quiet orbit" });
    expect(await caller.projects.update({ id: project.id, name: "Launch Nova" })).toMatchObject({ name: "Launch Nova" });
    expect(await caller.projects.list()).toHaveLength(1);
    await expect(caller.projects.delete({ id: project.id })).resolves.toEqual({ success: true });
    await expect(caller.projects.get({ id: project.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates, reads, updates, and deletes a task through the authenticated router", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    const project = await caller.projects.create({ name: "A project" });
    const task = await caller.tasks.create({ projectId: project.id, title: "Name the next move" });
    expect(await caller.tasks.list()).toEqual([expect.objectContaining({ id: task.id, status: "todo" })]);
    expect(await caller.tasks.updateStatus({ id: task.id, status: "in_progress" })).toMatchObject({ status: "in_progress" });
    await expect(caller.tasks.delete({ id: task.id })).resolves.toEqual({ success: true });
    expect(await caller.tasks.list()).toEqual([]);
  });

  it("isolates project reads and task changes between authenticated users", async () => {
    const owner = appRouter.createCaller(contextFor(41));
    const stranger = appRouter.createCaller(contextFor(82));
    const project = await owner.projects.create({ name: "Owner-only project" });
    const task = await owner.tasks.create({ projectId: project.id, title: "Owner-only task" });
    expect(await stranger.projects.list()).toEqual([]);
    expect(await stranger.tasks.list()).toEqual([]);
    await expect(stranger.projects.get({ id: project.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.projects.update({ id: project.id, name: "Not allowed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.projects.delete({ id: project.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.tasks.create({ projectId: project.id, title: "Not allowed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.tasks.updateStatus({ id: task.id, status: "done" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.tasks.delete({ id: task.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

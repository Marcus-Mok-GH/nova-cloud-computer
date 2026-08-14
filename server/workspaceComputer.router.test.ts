import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const folders = new Map<number, { id: number; ownerId: number; name: string }>();
const files = new Map<number, { id: number; ownerId: number; name: string; content: string }>();
const chats = new Map<number, { id: number; ownerId: number; title: string }>();
let nextId = 1;

vi.mock("./db", () => ({
  createWorkspaceFolderForUser: vi.fn(async (ownerId: number, input: { name: string }) => { const item = { id: nextId++, ownerId, name: input.name }; folders.set(item.id, item); return item; }),
  updateWorkspaceFolderForUser: vi.fn(async (ownerId: number, id: number, input: { name?: string }) => { const item = folders.get(id); if (!item || item.ownerId !== ownerId) return undefined; const updated = { ...item, name: input.name ?? item.name }; folders.set(id, updated); return updated; }),
  deleteWorkspaceFolderForUser: vi.fn(async (ownerId: number, id: number) => folders.get(id)?.ownerId === ownerId && folders.delete(id)),
  createWorkspaceFileForUser: vi.fn(async (ownerId: number, input: { name: string; content?: string }) => { const item = { id: nextId++, ownerId, name: input.name, content: input.content ?? "" }; files.set(item.id, item); return item; }),
  updateWorkspaceFileForUser: vi.fn(async (ownerId: number, id: number, input: { name?: string; content?: string }) => { const item = files.get(id); if (!item || item.ownerId !== ownerId) return undefined; const updated = { ...item, name: input.name ?? item.name, content: input.content ?? item.content }; files.set(id, updated); return updated; }),
  deleteWorkspaceFileForUser: vi.fn(async (ownerId: number, id: number) => files.get(id)?.ownerId === ownerId && files.delete(id)),
  createChatForUser: vi.fn(async (ownerId: number, title: string) => { const item = { id: nextId++, ownerId, title }; chats.set(item.id, item); return item; }),
  listChatMessagesForUser: vi.fn(async (ownerId: number, id: number) => chats.get(id)?.ownerId === ownerId ? [] : undefined),
  getWorkspaceComputer: vi.fn(async (ownerId: number) => ({ workspace: { id: ownerId }, folders: [...folders.values()].filter(item => item.ownerId === ownerId), files: [...files.values()].filter(item => item.ownerId === ownerId), chats: [...chats.values()].filter(item => item.ownerId === ownerId), settings: {} })),
  getOrCreateWorkspace: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
}));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
const { appRouter } = await import("./routers");
const context = (id: number): TrpcContext => ({ user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });

describe("workspace computer router", () => {
  beforeEach(() => { folders.clear(); files.clear(); chats.clear(); nextId = 1; });
  it("persists workspace folders, files, and chats for their owner", async () => {
    const owner = appRouter.createCaller(context(1));
    const folder = await owner.folders.create({ name: "Plans" });
    const file = await owner.files.create({ name: "brief.md", content: "Private draft" });
    const chat = await owner.chats.create({ title: "Plan launch" });
    await expect(owner.folders.update({ id: folder.id, name: "Updated plans" })).resolves.toMatchObject({ name: "Updated plans" });
    await expect(owner.files.update({ id: file.id, name: "updated-brief.md" })).resolves.toMatchObject({ name: "updated-brief.md" });
    expect(await owner.workspace.computer()).toMatchObject({ folders: [expect.objectContaining({ id: folder.id, name: "Updated plans" })], files: [expect.objectContaining({ id: file.id, name: "updated-brief.md" })], chats: [expect.objectContaining({ id: chat.id })] });
    await expect(owner.files.delete({ id: file.id })).resolves.toEqual({ success: true });
  });
  it("does not permit a second user to access or delete private computer items", async () => {
    const owner = appRouter.createCaller(context(1)); const stranger = appRouter.createCaller(context(2));
    const folder = await owner.folders.create({ name: "Private" }); const file = await owner.files.create({ name: "private.txt" }); const chat = await owner.chats.create({ title: "Private chat" });
    await expect(stranger.folders.delete({ id: folder.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.files.delete({ id: file.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stranger.chats.messages({ chatId: chat.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

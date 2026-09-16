import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

type ManagedUser = { id: number; name: string | null; email: string | null; role: "user" | "admin"; bannedAt: Date | null; createdAt: Date; lastSignedIn: Date };

const users = new Map<number, ManagedUser>();
const overviewSpy = vi.fn(async () => ({
  totals: { users: users.size, admins: [...users.values()].filter(user => user.role === "admin").length, chats: 3, messages: 12, projects: 2, tasks: 5, automations: 1, workspaces: users.size, telegramLinked: 1, activeAgentRuns: 0 },
  recentUsers: [...users.values()].slice(0, 5),
  recentAgentRuns: [],
}));
const listUsersSpy = vi.fn(async () => [...users.values()]);
const setUserRoleSpy = vi.fn(async (userId: number, role: "user" | "admin") => {
  const user = users.get(userId);
  if (!user) return undefined;
  user.role = role;
  return user;
});
const setUserBannedSpy = vi.fn(async (userId: number, banned: boolean) => {
  const user = users.get(userId);
  if (!user) return undefined;
  user.bannedAt = banned ? new Date() : null;
  return user;
});
const deleteUserSpy = vi.fn(async (userId: number) => users.delete(userId));
const countOtherActiveAdminsSpy = vi.fn(async (userId: number) =>
  [...users.values()].filter(u => u.id !== userId && u.role === "admin" && !u.bannedAt).length);

vi.mock("./admin", () => ({
  getAdminOverview: overviewSpy,
  listUsersForAdmin: listUsersSpy,
  setUserRoleForAdmin: setUserRoleSpy,
  setUserBannedForAdmin: setUserBannedSpy,
  deleteUserForAdmin: deleteUserSpy,
  countOtherActiveAdmins: countOtherActiveAdminsSpy,
}));

const { appRouter } = await import("./routers");

type UserRow = TrpcContext["user"];
function contextFor(user: UserRow): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function userRow(id: number, role: "user" | "admin" = "user"): UserRow {
  return { id, openId: `user-${id}`, name: `User ${id}`, email: `user${id}@example.com`, loginMethod: "test", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
}

describe("Nova admin console API", () => {
  beforeEach(() => { users.clear(); vi.clearAllMocks(); });

  it("lets an admin read the overview and user list", async () => {
    users.set(1, { id: 1, name: "Owner", email: "owner@example.com", role: "admin", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    const overview = await caller.admin.overview();
    expect(overview.totals).toMatchObject({ users: 2, admins: 1, chats: 3, messages: 12 });
    expect(await caller.admin.users()).toHaveLength(2);
  });

  it("blocks non-admins and anonymous callers from every admin endpoint", async () => {
    const member = appRouter.createCaller(contextFor(userRow(7, "user")));
    await expect(member.admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.admin.users()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.admin.setUserRole({ userId: 1, role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.admin.setUserBanned({ userId: 1, banned: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.admin.deleteUser({ userId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("promotes and demotes accounts through an admin caller", async () => {
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    const promoted = await caller.admin.setUserRole({ userId: 2, role: "admin" });
    expect(promoted).toMatchObject({ success: true, user: { id: 2, role: "admin" } });
    const demoted = await caller.admin.setUserRole({ userId: 2, role: "user" });
    expect(demoted).toMatchObject({ success: true, user: { id: 2, role: "user" } });
  });

  it("lets an admin demote themselves while another active admin exists", async () => {
    users.set(1, { id: 1, name: "Owner", email: "owner@example.com", role: "admin", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "admin", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    const result = await caller.admin.setUserRole({ userId: 1, role: "user" });
    expect(result.user.role).toBe("user");
    users.set(1, { ...users.get(1)!, role: "admin" }); // restore for later tests
    users.set(2, { ...users.get(2)!, role: "user" }); // restore for later tests
  });

  it("refuses self-promotion and refuses self-demotion for the last active admin", async () => {
    users.set(1, { id: 1, name: "Owner", email: "owner@example.com", role: "admin", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "admin", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    await expect(caller.admin.setUserRole({ userId: 1, role: "admin" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Temporarily make the caller the only active admin.
    const helper = users.get(2);
    if (helper) users.set(2, { ...helper, role: "user" });
    await expect(caller.admin.setUserRole({ userId: 1, role: "user" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    if (helper) users.set(2, { ...helper });
  });

  it("does not count banned admins when deciding if self-demotion is safe", async () => {
    users.set(1, { id: 1, name: "Owner", email: "owner@example.com", role: "admin", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    users.set(2, { id: 2, name: "Admin2", email: "admin2@example.com", role: "admin", bannedAt: new Date(), createdAt: new Date(), lastSignedIn: new Date() });
    await expect(caller.admin.setUserRole({ userId: 1, role: "user" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
  });

  it("reports unknown accounts as not found", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    await expect(caller.admin.setUserRole({ userId: 999, role: "admin" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.admin.setUserBanned({ userId: 999, banned: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.admin.deleteUser({ userId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("bans and unbans accounts through an admin caller", async () => {
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    const banned = await caller.admin.setUserBanned({ userId: 2, banned: true });
    expect(banned.user.bannedAt).toBeInstanceOf(Date);
    const unbanned = await caller.admin.setUserBanned({ userId: 2, banned: false });
    expect(unbanned.user.bannedAt).toBeNull();
  });

  it("refuses to let an admin ban or delete their own account", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    await expect(caller.admin.setUserBanned({ userId: 1, banned: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.admin.deleteUser({ userId: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deletes another account through an admin caller", async () => {
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", bannedAt: null, createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    await expect(caller.admin.deleteUser({ userId: 2 })).resolves.toEqual({ success: true });
    expect(users.has(2)).toBe(false);
  });
});

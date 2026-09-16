import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

type ManagedUser = { id: number; name: string | null; email: string | null; role: "user" | "admin"; createdAt: Date; lastSignedIn: Date };

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

vi.mock("./admin", () => ({
  getAdminOverview: overviewSpy,
  listUsersForAdmin: listUsersSpy,
  setUserRoleForAdmin: setUserRoleSpy,
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
    users.set(1, { id: 1, name: "Owner", email: "owner@example.com", role: "admin", createdAt: new Date(), lastSignedIn: new Date() });
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", createdAt: new Date(), lastSignedIn: new Date() });
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
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("promotes and demotes accounts through an admin caller", async () => {
    users.set(2, { id: 2, name: "Helper", email: "helper@example.com", role: "user", createdAt: new Date(), lastSignedIn: new Date() });
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    const promoted = await caller.admin.setUserRole({ userId: 2, role: "admin" });
    expect(promoted).toMatchObject({ success: true, user: { id: 2, role: "admin" } });
    const demoted = await caller.admin.setUserRole({ userId: 2, role: "user" });
    expect(demoted).toMatchObject({ success: true, user: { id: 2, role: "user" } });
  });

  it("refuses to change the caller's own role, even for an admin", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    await expect(caller.admin.setUserRole({ userId: 1, role: "user" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reports unknown accounts as not found", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1, "admin")));
    await expect(caller.admin.setUserRole({ userId: 999, role: "admin" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

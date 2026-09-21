import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const users = new Map<number, { id: number; username: string | null }>();
const isUsernameTakenSpy = vi.fn(async (username: string) =>
  [...users.values()].some(user => user.username === username));
const setUsernameForUserSpy = vi.fn(async (userId: number, username: string) => {
  const user = users.get(userId);
  if (!user) return undefined;
  user.username = username;
  return { ...user, email: null, name: null };
});

vi.mock("./db", () => ({
  getActiveCustomModelForUser: vi.fn(async () => null),
  isUsernameTaken: isUsernameTakenSpy,
  setUsernameForUser: setUsernameForUserSpy,
}));

const { appRouter } = await import("./routers");

type UserRow = TrpcContext["user"];
function contextFor(user: UserRow): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function userRow(id: number): UserRow {
  return { id, openId: `user-${id}`, email: `user${id}@example.com`, name: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
}

describe("auth.setUsername", () => {
  it("claims an available username for the signed-in account", async () => {
    users.set(1, { id: 1, username: null });
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const updated = await caller.auth.setUsername({ username: "Marcus" });
    expect(updated).toMatchObject({ id: 1, username: "marcus" });
  });

  it("rejects usernames that are already taken", async () => {
    users.set(1, { id: 1, username: null });
    users.set(2, { id: 2, username: "marcus" });
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.auth.setUsername({ username: "MARCUS" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects invalid formats", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.auth.setUsername({ username: "ab" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.auth.setUsername({ username: "has space" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.auth.setUsername({ username: "nø!" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires a signed-in account", async () => {
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.auth.setUsername({ username: "someone" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

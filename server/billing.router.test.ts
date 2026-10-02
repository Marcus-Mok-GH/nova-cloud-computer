import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPriorityStatusForUser = vi.fn(async () => ({ priority: false, armed: false, purchasedAt: null as Date | null, activatedAt: null as Date | null, expiresAt: null as Date | null }));
const purchasePriorityForUser = vi.fn(async () => ({ priority: false, armed: true, purchasedAt: new Date(), activatedAt: null as Date | null, expiresAt: null as Date | null }));

vi.mock("./db", () => ({
  getDailyCreditStatusForUser: vi.fn(async () => ({ region: "global", creditDay: "2026-09-24", dailyCredits: 500, usedCredits: 0, remainingCredits: 500, creditValueCents: 1 })),
  getActiveCustomModelForUser: vi.fn(async () => null),
  getPriorityStatusForUser,
  purchasePriorityForUser,
}));

const { appRouter } = await import("./routers");

type UserRow = TrpcContext["user"];
function contextFor(user: UserRow): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function userRow(id: number): UserRow {
  return { id, openId: `user-${id}`, email: `user${id}@example.com`, name: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
}

describe("billing router", () => {
  it("reports whether priority has been purchased", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.status()).resolves.toEqual({ priority: false, armed: false, purchasedAt: null, activatedAt: null, expiresAt: null });
    expect(getPriorityStatusForUser).toHaveBeenCalledWith(1);
  });

  it("arms a one-time priority purchase without a payment step", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.purchasePriority();
    expect(purchasePriorityForUser).toHaveBeenCalledWith(1);
    // Buying arms the purchase; the hour starts on the first message, not here.
    expect(result.armed).toBe(true);
    expect(result.priority).toBe(false);
    expect(result.purchasedAt).toBeInstanceOf(Date);
  });

  it("requires a signed-in account", async () => {
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.billing.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.billing.purchasePriority()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

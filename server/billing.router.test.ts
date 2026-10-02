import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getBillingStatusForUser = vi.fn(async () => ({ plan: "standard" as const, priority: false, updatedAt: null }));
const setBillingPlanForUser = vi.fn(async (_ownerId: number, plan: "standard" | "priority") => ({
  plan,
  priority: plan === "priority",
  updatedAt: new Date(),
}));

vi.mock("./db", () => ({
  getDailyCreditStatusForUser: vi.fn(async () => ({ region: "global", creditDay: "2026-09-24", dailyCredits: 500, usedCredits: 0, remainingCredits: 500, creditValueCents: 1 })),
  getActiveCustomModelForUser: vi.fn(async () => null),
  getBillingStatusForUser,
  setBillingPlanForUser,
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
  it("reports the signed-in account's plan", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.status()).resolves.toMatchObject({ plan: "standard", priority: false });
    expect(getBillingStatusForUser).toHaveBeenCalledWith(1);
  });

  it("upgrades to priority without a payment step", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.setPriority({ enabled: true });
    expect(setBillingPlanForUser).toHaveBeenCalledWith(1, "priority");
    expect(result.priority).toBe(true);
  });

  it("returns to the standard plan", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.setPriority({ enabled: false });
    expect(setBillingPlanForUser).toHaveBeenCalledWith(1, "standard");
    expect(result.priority).toBe(false);
  });

  it("requires a signed-in account", async () => {
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.billing.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.billing.setPriority({ enabled: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

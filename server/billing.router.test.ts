import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPriorityStatusForUser = vi.fn(async () => ({
  priority: false,
  armed: false,
  purchasedAt: null as Date | null,
  activatedAt: null as Date | null,
  expiresAt: null as Date | null,
}));
const createWhopPriorityCheckout = vi.fn(async () => ({
  id: "ch_priority_1",
  purchaseUrl: "https://whop.com/checkout/plan_priority",
}));
const isWhopConfigured = vi.fn(() => true);
const getWhopPriorityPlanId = vi.fn(() => "plan_BFyuf6PmE5wwz");

vi.mock("./db", () => ({
  getDailyCreditStatusForUser: vi.fn(async () => ({
    region: "global",
    creditDay: "2026-09-24",
    dailyCredits: 500,
    usedCredits: 0,
    remainingCredits: 500,
    creditValueCents: 1,
  })),
  getActiveCustomModelForUser: vi.fn(async () => null),
  getPriorityStatusForUser,
}));

vi.mock("./whop", () => ({
  createWhopCheckout: vi.fn(),
  createWhopPriorityCheckout,
  getWhopPlanId: vi.fn(() => "plan_pro"),
  getWhopPriorityPlanId,
  isWhopConfigured,
  whopConfigurationMessage: () => "Nova Pro is not configured on this deployment. Contact the administrator to enable paid subscriptions.",
  whopPriorityConfigurationMessage: () =>
    "Priority purchases are not configured on this deployment yet. Contact the administrator to enable them.",
}));

const { appRouter } = await import("./routers");

type UserRow = TrpcContext["user"];
function contextFor(user: UserRow): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function userRow(id: number): UserRow {
  return {
    id,
    openId: `user-${id}`,
    email: `user${id}@example.com`,
    name: null,
    loginMethod: "test",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

describe("billing router", () => {
  beforeEach(() => {
    getPriorityStatusForUser.mockClear();
    createWhopPriorityCheckout.mockClear();
    isWhopConfigured.mockReset();
    isWhopConfigured.mockReturnValue(true);
    getWhopPriorityPlanId.mockReset();
    getWhopPriorityPlanId.mockReturnValue("plan_BFyuf6PmE5wwz");
    getPriorityStatusForUser.mockResolvedValue({
      priority: false,
      armed: false,
      purchasedAt: null,
      activatedAt: null,
      expiresAt: null,
    });
  });

  it("reports whether priority has been purchased", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.status()).resolves.toEqual({
      priority: false,
      armed: false,
      purchasedAt: null,
      activatedAt: null,
      expiresAt: null,
    });
    expect(getPriorityStatusForUser).toHaveBeenCalledWith(1);
  });

  it("opens Whop checkout for a one-time priority purchase", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.purchasePriority({
      redirectUrl: "https://novacloud.computer/settings?priority=success",
    });
    expect(createWhopPriorityCheckout).toHaveBeenCalledWith({
      ownerId: 1,
      planId: "plan_BFyuf6PmE5wwz",
      redirectUrl: "https://novacloud.computer/settings?priority=success",
    });
    expect(result).toEqual({ url: "https://whop.com/checkout/plan_priority" });
  });

  it("rejects priority checkout when Whop is not configured", async () => {
    isWhopConfigured.mockReturnValue(false);
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.purchasePriority()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createWhopPriorityCheckout).not.toHaveBeenCalled();
  });

  it("rejects priority checkout when the priority plan id is missing", async () => {
    getWhopPriorityPlanId.mockReturnValue(undefined);
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.purchasePriority()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createWhopPriorityCheckout).not.toHaveBeenCalled();
  });

  it("rejects priority checkout when priority is already armed", async () => {
    getPriorityStatusForUser.mockResolvedValue({
      priority: false,
      armed: true,
      purchasedAt: new Date(),
      activatedAt: null,
      expiresAt: null,
    });
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.purchasePriority()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(createWhopPriorityCheckout).not.toHaveBeenCalled();
  });

  it("requires a signed-in account", async () => {
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.billing.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.billing.purchasePriority()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

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
const createWhopCreditTopUpCheckout = vi.fn(async () => ({
  id: "ch_credits_1",
  purchaseUrl: "https://whop.com/checkout/credits",
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
  getSubscriptionForUser: vi.fn(async () => ({
    plan: "free",
    status: "inactive",
    provider: "whop",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    whopCheckoutConfigId: null,
  })),
  getMonthlyCreditStatusForUser: vi.fn(async () => ({
    plan: "free",
    creditMonth: "2026-11",
    monthlyAllocation: 0,
    balanceCredits: 0,
    usedCreditsThisMonth: 0,
    carriedOverCredits: 0,
    carryOverMonths: 12,
    inputTokens: 0,
    outputTokens: 0,
    creditValueCents: 1,
  })),
  getCreditTopUpBalanceForUser: vi.fn(async () => ({
    remainingCredits: 0,
    activeBundles: 0,
    purchasedCredits: 0,
  })),
}));

vi.mock("./whop", () => ({
  createWhopCheckout: vi.fn(),
  createWhopCreditTopUpCheckout,
  createWhopPriorityCheckout,
  getWhopPlanId: vi.fn(() => "plan_pro"),
  getWhopPriorityPlanId,
  isWhopConfigured,
  isWhopCheckoutDebug: () => false,
  WhopNotConfiguredError: class extends Error {},
  whopConfigurationMessage: () => "Nova Pro is not configured on this deployment. Contact the administrator to enable paid subscriptions.",
  whopCreditTopUpConfigurationMessage: () =>
    "Credit top-ups are not available on this deployment yet. Contact the administrator to enable them.",
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
    createWhopCreditTopUpCheckout.mockClear();
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
    createWhopCreditTopUpCheckout.mockResolvedValue({
      id: "ch_credits_1",
      purchaseUrl: "https://whop.com/checkout/credits",
    });
  });

  it("opens checkout for a credit bundle, priced from the catalog", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.purchaseCredits({
      productId: "topup-10",
      redirectUrl: "https://novacloud.computer/app/billing",
    });
    // The server must resolve the bundle itself - the client only names an id.
    expect(createWhopCreditTopUpCheckout).toHaveBeenCalledWith({
      ownerId: 1,
      product: { id: "topup-10", priceCents: 1_000, credits: 10_000 },
      redirectUrl: "https://novacloud.computer/app/billing",
    });
    expect(result).toEqual({ url: "https://whop.com/checkout/credits" });
  });

  it("rejects a bundle id that is not on the ladder without calling the provider", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(
      caller.billing.purchaseCredits({ productId: "topup-9999" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createWhopCreditTopUpCheckout).not.toHaveBeenCalled();
  });

  it("rejects credit checkout when Whop is not configured", async () => {
    isWhopConfigured.mockReturnValue(false);
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(
      caller.billing.purchaseCredits({ productId: "topup-5" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createWhopCreditTopUpCheckout).not.toHaveBeenCalled();
  });

  it("exposes the ladder and the bought-credit balance on the subscription read", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.subscription();
    expect(result.topUpCurrency).toBe("sgd");
    expect(result.topUpProducts.map((p: { id: string; priceCents: number; credits: number }) => [p.id, p.priceCents, p.credits])).toEqual([
      ["topup-5", 500, 5_000],
      ["topup-10", 1_000, 10_000],
      ["topup-20", 2_000, 20_000],
      ["topup-30", 3_000, 30_000],
      ["topup-40", 4_000, 40_000],
      ["topup-50", 5_000, 50_000],
    ]);
    expect(result.topUpProducts[0].price).toBe("S$5");
    expect(result.creditTopUps).toEqual({ remainingCredits: 0, activeBundles: 0, purchasedCredits: 0 });
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

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
const createWhopCheckout = vi.fn(async () => ({
  id: "ch_pro_1",
  purchaseUrl: "https://whop.com/checkout/pro",
}));
const isWhopConfigured = vi.fn(() => true);
const getWhopPriorityPlanId = vi.fn(() => "plan_BFyuf6PmE5wwz");
const getWhopPlusPlanId = vi.fn(() => "plan_plus");
/** The Pro-entitlement gate (paid subscription OR console-operator role). */
const hasProAccessForUser = vi.fn(async () => false);
/** The usage gate: Pro access OR a still-open 14-day free trial. */
const hasActiveAccessForUser = vi.fn(async () => true);
/** When the account's free trial ends (createdAt + 14 days); null = unknown. */
const getFreeTrialEndsAtForUser = vi.fn(async () => null);
/** The account's subscription row as billing sees it (free / plus / paid). */
const getSubscriptionForUser = vi.fn(async (): Promise<{
  plan: "free" | "plus" | "paid";
  status: string;
  provider: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  whopCheckoutConfigId: string | null;
}> => ({
  plan: "free",
  status: "inactive",
  provider: "whop",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  whopCheckoutConfigId: null,
}));

vi.mock("./db", () => ({
  hasActiveAccessForUser,
  getFreeTrialEndsAtForUser,
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
  hasProAccessForUser,
  getSubscriptionForUser,
  getCreditTopUpBalanceForUser: vi.fn(async () => ({
    remainingCredits: 0,
    activeBundles: 0,
    purchasedCredits: 0,
  })),
  setWhopCheckoutConfigIdForUser: vi.fn(async () => undefined),
}));

vi.mock("./whop", () => ({
  createWhopCheckout,
  createWhopCreditTopUpCheckout,
  createWhopPriorityCheckout,
  getWhopPlanId: vi.fn(() => "plan_pro"),
  getWhopPlusPlanId,
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
    createWhopCheckout.mockClear();
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
    hasProAccessForUser.mockClear();
    hasProAccessForUser.mockResolvedValue(false);
    hasActiveAccessForUser.mockClear();
    hasActiveAccessForUser.mockResolvedValue(true);
    getFreeTrialEndsAtForUser.mockClear();
    getFreeTrialEndsAtForUser.mockResolvedValue(null);
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
    // The monthly pool is gone: every tier draws from the daily ledger now.
    expect(result.monthlyCredits).toBeUndefined();
  });

  it("opens Pro checkout by default", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.createCheckout({
      redirectUrl: "https://novacloud.computer/app/billing",
    });
    expect(createWhopCheckout).toHaveBeenCalledWith({
      ownerId: 1,
      plan: "pro",
      planId: "plan_pro",
      redirectUrl: "https://novacloud.computer/app/billing",
    });
    expect(result).toEqual({ url: "https://whop.com/checkout/pro" });
  });

  it("opens Plus checkout with the Plus plan id", async () => {
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    const result = await caller.billing.createCheckout({
      plan: "plus",
      redirectUrl: "https://novacloud.computer/app/billing",
    });
    expect(createWhopCheckout).toHaveBeenCalledWith({
      ownerId: 1,
      plan: "plus",
      planId: "plan_plus",
      redirectUrl: "https://novacloud.computer/app/billing",
    });
    expect(result).toEqual({ url: "https://whop.com/checkout/pro" });
  });

  it("refuses to sell a tier the account already holds", async () => {
    getSubscriptionForUser.mockResolvedValueOnce({
      plan: "plus",
      status: "active",
      provider: "whop",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
      whopCheckoutConfigId: null,
    });
    const caller = appRouter.createCaller(contextFor(userRow(1)));
    await expect(caller.billing.createCheckout({ plan: "plus" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(createWhopCheckout).not.toHaveBeenCalled();
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

  describe("billing.subscription Pro access flag", () => {
    it("reports proAccess false for a standard user on a free plan", async () => {
      const caller = appRouter.createCaller(contextFor(userRow(1)));
      const result = await caller.billing.subscription();
      expect(result.plan).toBe("free");
      expect(result.proAccess).toBe(false);
      // A fresh account is still inside its trial window.
      expect(result.accessActive).toBe(true);
      expect(result.trialEndsAt).toBeNull();
    });

    it("reports proAccess true for an account with Pro entitlement", async () => {
      hasProAccessForUser.mockResolvedValueOnce(true);
      const caller = appRouter.createCaller(contextFor(userRow(2)));
      const result = await caller.billing.subscription();
      // The raw subscription may still say free (an operator); the flag is
      // what the client's Pro locks read.
      expect(result.proAccess).toBe(true);
      expect(result.accessActive).toBe(true);
    });

    it("reports the trial clock closing: accessActive false once the 14 days are spent", async () => {
      hasActiveAccessForUser.mockResolvedValueOnce(false);
      const caller = appRouter.createCaller(contextFor(userRow(3)));
      const result = await caller.billing.subscription();
      expect(result.plan).toBe("free");
      expect(result.proAccess).toBe(false);
      expect(result.accessActive).toBe(false);
    });
  });

  it("requires a signed-in account", async () => {
    const anonymous = appRouter.createCaller(contextFor(null));
    await expect(anonymous.billing.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.billing.purchasePriority()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
